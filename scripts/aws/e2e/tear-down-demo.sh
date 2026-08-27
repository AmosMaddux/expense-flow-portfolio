#!/usr/bin/env bash
set -euo pipefail

# Tears down everything scripts/aws/e2e/deploy-demo.sh creates, in order:
#
#   1. Empties the SPA and receipt-storage S3 buckets (all object versions,
#      including delete markers). The persistent ECR root is intentionally
#      left untouched so repositories and images stay available for a later
#      deploy-demo.sh run.
#   2. Runs `terraform destroy` against infra/terraform/environments/sandbox,
#      routed through an SSM tunnel to the bastion. This is required even if
#      RUN_READONLY_ROLE_STEP was never used to apply GL-coding's readonly
#      role/vector extension: once any postgresql_role/postgresql_extension
#      resource exists in Terraform state, EVERY plan or destroy against this
#      state needs to refresh it first, which needs the postgresql provider
#      to reach RDS - the same network requirement applies to a destroy that
#      only ever created these resources through the bastion tunnel in the
#      first place. The bastion itself is destroyed only after Terraform has
#      finished using it to refresh/destroy everything else, so the tunnel
#      stays usable for the whole destroy.
#   3. Deletes the JWT issuer CloudFormation stack
#      (scripts/aws/deploy-jwt-issuer.sh's STACK_NAME).
#   4. Force-deletes Terraform-managed ephemeral runtime Secrets Manager
#      secrets so immediate redeploys do not collide with names that are
#      scheduled for deletion.
#
# What this script does NOT touch:
#   - infra/terraform/bootstrap (owns the Terraform state bucket - destroying
#     it would delete the state this destroy needs to run, and there is no
#     reason to recreate it for a routine teardown/redeploy cycle).
#   - The three deploy-demo.sh ECR repositories and any images they contain:
#     expenseflow-sandbox-core-case-service,
#     expenseflow-sandbox-gl-coding-service, and
#     expenseflow-sandbox-stage-transition-consumer-lambda.
#   - expenseflow-platform-bootstrap-sandbox (the JWT issuer's own SAM
#     deployment-artifact-bucket stack - reused across every JWT issuer
#     deploy, not something deploy-demo.sh creates per run).
#   - Two older CloudFormation stacks found live in this account,
#     expenseflow-http-api-sandbox and expenseflow-jwt-issuer-sandbox, that
#     predate the current bastion/deploy-demo.sh setup and are not created
#     or referenced by any script in this flow. Investigate separately
#     before deleting those - this script does not assume they are safe to
#     remove.
#
# This runs a real `terraform destroy` against real, billed AWS
# infrastructure. Nothing here is reversible.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
export AWS_PAGER=""

NAME_PREFIX="${NAME_PREFIX:-expenseflow-sandbox}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"
JWT_ISSUER_STACK_NAME="${JWT_ISSUER_STACK_NAME:-expenseflow-http-api-issuer-sandbox}"
TUNNEL_LOCAL_PORT="${TUNNEL_LOCAL_PORT:-15432}"

ROLE_PERMISSIONS_BOUNDARY_ARN="${ROLE_PERMISSIONS_BOUNDARY_ARN:-arn:aws:iam::208096650110:policy/TraineeSandboxBoundary}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

require_tool() {
    local tool="$1"

    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is required. Install it before running this script." >&2
        exit 1
    fi
}

for tool in terraform aws jq sam session-manager-plugin nc; do
    require_tool "$tool"
done

if [[ ! -d "$TERRAFORM_DIR" ]]; then
    echo "Run this script from the repository root." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

tf_output() {
    terraform -chdir="$TERRAFORM_DIR" output -raw "$1" 2>/dev/null || true
}

empty_versioned_bucket() {
    local bucket_name="$1"

    if ! aws_cli s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        echo "  $bucket_name does not exist, skipping."
        return 0
    fi

    echo "  Deleting all object versions and delete markers in $bucket_name..."
    aws_cli s3api list-object-versions \
        --bucket "$bucket_name" \
        --output json \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
        | jq -c '.Objects // [] | [range(0; length; 1000) as $i | .[$i:$i+1000]] | .[] | {Objects: ., Quiet: true}' \
        | while read -r batch; do
            aws_cli s3api delete-objects --bucket "$bucket_name" --delete "$batch" >/dev/null
        done

    aws_cli s3api list-object-versions \
        --bucket "$bucket_name" \
        --output json \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
        | jq -c '.Objects // [] | [range(0; length; 1000) as $i | .[$i:$i+1000]] | .[] | {Objects: ., Quiet: true}' \
        | while read -r batch; do
            aws_cli s3api delete-objects --bucket "$bucket_name" --delete "$batch" >/dev/null
        done
}

run_destroy_through_tunnel() {
    local bastion_instance_id core_case_db_host db_secret_arn tunnel_pid
    local tunnel_log destroy_status tunnel_cleaned

    bastion_instance_id="$(tf_output bastion_instance_id)"
    core_case_db_host="$(tf_output core_case_db_endpoint | cut -d: -f1)"
    db_secret_arn="$(tf_output core_case_db_master_user_secret_arn)"

    if [[ -z "$bastion_instance_id" || -z "$core_case_db_host" || -z "$db_secret_arn" ]]; then
        echo "  Could not resolve bastion/RDS outputs - infrastructure may" >&2
        echo "  already be partially or fully destroyed. Falling back to a" >&2
        echo "  direct destroy attempt (will fail if postgresql_role/extension" >&2
        echo "  resources still need the tunnel)." >&2
        run_destroy_direct
        return $?
    fi

    tunnel_log="$(mktemp)"
    # See run_readonly_role_step in scripts/aws/e2e/deploy-demo.sh for why
    # `set -m` and `kill -- -PID` (not just `kill PID`) are both required to
    # clean up session-manager-plugin, not just the `aws` process.
    set -m
    aws_cli ssm start-session \
        --target "$bastion_instance_id" \
        --document-name AWS-StartPortForwardingSessionToRemoteHost \
        --parameters "{\"host\":[\"$core_case_db_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$TUNNEL_LOCAL_PORT\"]}" \
        >"$tunnel_log" 2>&1 &
    tunnel_pid=$!
    set +m

    cleanup_tunnel() {
        if [[ "${tunnel_cleaned:-false}" == "true" ]]; then
            return
        fi
        tunnel_cleaned=true
        kill -- "-$tunnel_pid" 2>/dev/null || true
        wait "$tunnel_pid" 2>/dev/null || true
        rm -f "$tunnel_log"
        trap - RETURN EXIT
    }
    trap cleanup_tunnel RETURN EXIT

    local waited=0
    until nc -z localhost "$TUNNEL_LOCAL_PORT" 2>/dev/null; do
        if ! kill -0 "$tunnel_pid" 2>/dev/null; then
            echo "Bastion SSM tunnel exited before it started listening:" >&2
            cat "$tunnel_log" >&2
            return 1
        fi
        if (( waited >= 30 )); then
            echo "Timed out waiting for the bastion SSM tunnel to start listening on localhost:$TUNNEL_LOCAL_PORT." >&2
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # Fetched directly rather than via asm-exec - see
    # infra/terraform/modules/database/README.md's "Master credentials"
    # section for why this is an approved pattern outside an agent context.
    # The password lives only in this function's local shell state and the
    # child terraform process's environment, never printed or logged.
    local db_secret db_password
    db_secret="$(aws_cli secretsmanager get-secret-value \
        --secret-id "$db_secret_arn" --query SecretString --output text)"
    db_password="$(echo "$db_secret" | jq -r .password)"
    unset db_secret

    destroy_status=0
    PGUSER=core_case_admin PGPASSWORD="$db_password" \
        run_destroy_direct \
        -var="postgresql_provider_host=localhost" \
        -var="postgresql_provider_port=$TUNNEL_LOCAL_PORT" \
        || destroy_status=$?
    unset db_password

    return "$destroy_status"
}

run_destroy_direct() {
    local destroy_args=(-input=false)
    if [[ "$AUTO_APPROVE" == "true" ]]; then
        destroy_args+=(-auto-approve)
    fi

    local account_id placeholder_secret_arn placeholder_image
    account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
    placeholder_secret_arn="arn:aws:secretsmanager:$AWS_REGION:$account_id:secret:placeholder-000000"
    placeholder_image="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com/placeholder:placeholder"

    terraform -chdir="$TERRAFORM_DIR" destroy "${destroy_args[@]}" "$@" \
        -var="http_api_jwt_issuer=https://placeholder.execute-api.$AWS_REGION.amazonaws.com" \
        -var="core_case_internal_command_token_secret_arn=$placeholder_secret_arn" \
        -var="core_case_auth_jwt_private_key_secret_arn=$placeholder_secret_arn" \
        -var="gl_coding_auth_jwt_public_keys_json_secret_arn=$placeholder_secret_arn" \
        -var="core_case_mfa_totp_secret_encryption_key_secret_arn=$placeholder_secret_arn" \
        -var="role_permissions_boundary_arn=$ROLE_PERMISSIONS_BOUNDARY_ARN" \
        -var="enable_nat_gateway=false" \
        -var="db_enable_enhanced_monitoring=false" \
        -var="allow_plain_http_public_api=true" \
        -var="core_case_internal_routes_enabled=true" \
        -var="core_case_repository_url=$placeholder_image" \
        -var="core_case_repository_arn=arn:aws:ecr:$AWS_REGION:$account_id:repository/placeholder" \
        -var="gl_coding_repository_url=$placeholder_image" \
        -var="stage_transition_lambda_repository_url=$placeholder_image" \
        -var="core_case_image_uri=$placeholder_image" \
        -var="gl_coding_image_uri=$placeholder_image" \
        -var="stage_transition_lambda_image_uri=$placeholder_image"
}

force_delete_runtime_secret() {
    local secret_id="$1"
    local waited=0

    echo "  Force-deleting $secret_id..."
    aws_cli secretsmanager delete-secret \
        --secret-id "$secret_id" \
        --force-delete-without-recovery >/dev/null

    # Secrets Manager permanent deletion is asynchronous; wait briefly so a
    # follow-on deploy can recreate the same fixed sandbox secret names.
    until ! aws_cli secretsmanager describe-secret --secret-id "$secret_id" >/dev/null 2>&1; do
        if (( waited >= 60 )); then
            echo "  $secret_id is still visible after 60 seconds; Secrets Manager may still be finishing deletion." >&2
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done
}

force_delete_runtime_secrets() {
    local runtime_secret_names=(
        "${NAME_PREFIX}-core-case-db-gl_coding_app"
        "${NAME_PREFIX}-stage-transition-consumer-database-url"
        "${NAME_PREFIX}-core-case-redis-auth-token"
        "${NAME_PREFIX}-core-case-redis-url"
    )

    for secret_name in "${runtime_secret_names[@]}"; do
        force_delete_runtime_secret "$secret_name"
    done
}

echo "=== 1/3: Emptying S3 buckets ==="
spa_bucket="$(tf_output spa_bucket_name)"
receipt_bucket="$(tf_output receipt_storage_bucket_name)"

if [[ -n "$spa_bucket" ]]; then
    empty_versioned_bucket "$spa_bucket"
else
    echo "  spa_bucket_name output not found (already destroyed?), skipping SPA bucket."
fi

if [[ -n "$receipt_bucket" ]]; then
    empty_versioned_bucket "$receipt_bucket"
else
    echo "  receipt_storage_bucket_name output not found (already destroyed?), skipping receipt bucket."
fi

echo "=== 2/3: Running terraform destroy (via bastion tunnel) ==="
# Every root variable must be supplied for destroy to validate, the same way
# deploy-demo.sh's targeted applies do - the values do not need to be the
# real ones since nothing is being created, but they must be well-formed
# (a valid-looking ARN, a valid image reference) or Terraform's own
# variable validation blocks the plan before destroy ever runs. See
# run_destroy_through_tunnel above for why the tunnel is required even if
# RUN_READONLY_ROLE_STEP was never used during deploy.
run_destroy_through_tunnel

echo "=== 2b/3: Force-deleting ephemeral runtime secrets ==="
force_delete_runtime_secrets

echo "=== 3/3: Deleting the JWT issuer CloudFormation stack ==="
if aws_cli cloudformation describe-stacks --stack-name "$JWT_ISSUER_STACK_NAME" >/dev/null 2>&1; then
    sam delete \
        --stack-name "$JWT_ISSUER_STACK_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --no-prompts
else
    echo "  $JWT_ISSUER_STACK_NAME does not exist, skipping."
fi

echo
echo "Teardown complete."
echo
echo "Not touched (see this script's header comment for why):"
echo "  - infra/terraform/bootstrap (Terraform state bucket)"
echo "  - infra/terraform/environments/sandbox-ecr (persistent ECR repositories/images)"
echo "  - expenseflow-platform-bootstrap-sandbox (JWT issuer SAM artifact bucket)"
echo "  - expenseflow-http-api-sandbox / expenseflow-jwt-issuer-sandbox (older,"
echo "    unreferenced stacks - investigate separately before deleting)"
