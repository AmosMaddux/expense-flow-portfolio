#!/usr/bin/env bash
set -euo pipefail

# One-command demo deploy for the Terraform-managed sandbox
# (infra/terraform/environments/sandbox). Runs everything a fresh spin-up
# needs, in order:
#
#   1. Generates/rotates the demo-grade Secrets Manager secrets
#      (scripts/aws/generate-sandbox-secrets.sh) - safe to re-run.
#   2. Packages and deploys the shared JWT issuer stack
#      (scripts/aws/package-jwt-issuer.sh, deploy-jwt-issuer.sh).
#   3. Applies the persistent sandbox ECR root, importing existing demo ECR
#      repositories into that root when needed so images are preserved across
#      runtime teardowns.
#   4. Builds and pushes Core Case, GL-coding, and the stage-transition
#      consumer Lambda images, tagged with the current UTC timestamp so
#      re-runs never collide with the ECR repositories' IMMUTABLE tag
#      setting.
#   5. Runs the full terraform apply with everything wired together. On a
#      fresh deploy, this creates the bastion (module.bastion) before the
#      PostgreSQL-managed resources are applied in step 5b. On a redeploy
#      where those PostgreSQL resources already exist in state, this apply
#      runs through the bastion SSM tunnel too, because Terraform must refresh
#      those state entries before it can plan anything else.
#   6. Builds the SPA with VITE_TENANT_ID baked in and deploys it to the SPA
#      bucket + CloudFront.
#   7. Runs database migrations, seeds the ten synthetic sign-in accounts,
#      and seeds demo expense data, all via the bastion over SSM
#      (scripts/aws/bastion-run.sh) - no tunnel needed for any of these.
#   8. Runs a ZAP API scan (scripts/ci/run-zap-baseline-gate.sh) against the
#      just-deployed Core Case Service's live OpenAPI document and fails the
#      deploy on any High-severity finding
#      (scripts/ci/check-zap-baseline-severity.sh) - see
#      docs/secure-release-gate.md's "ZAP" section. SKIP_ZAP_SCAN=true
#      skips this step.
#
# GL-coding's least-privilege database role and the "vector" extension
# (module.database_core_case's readonly_roles/extensions) are intentionally
# split into step 5b because they need Terraform's postgresql provider to
# reach private RDS through the bastion. Set RUN_READONLY_ROLE_STEP=false only
# for a partial deploy where GL-coding and pgvector-backed policy retrieval are
# explicitly not being verified.
#
# This does not run the Trivy/Syft/Cosign secure release gate that
# build-push-images.sh normally runs after each push - see that script's
# scan_and_sign_image step if you want it for this run too.
#
# This is a demo-environment deploy, not a production release process. It
# runs a real `terraform apply` against real, billed AWS infrastructure.
# Nothing here tears the environment down afterward.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
export AWS_PROFILE
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
export AWS_PAGER=""

NAME_PREFIX="${NAME_PREFIX:-expenseflow-sandbox}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
ECR_TERRAFORM_DIR="${ECR_TERRAFORM_DIR:-infra/terraform/environments/sandbox-ecr}"
IMAGE_TAG="${IMAGE_TAG:-demo-$(date -u +%Y%m%dt%H%M%Sz)}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"
EXISTING_VPC_NAME="${EXISTING_VPC_NAME:-project-vpc}"
HTTP_API_LAMBDA_VPC_ID="${HTTP_API_LAMBDA_VPC_ID:-${TF_VAR_http_api_lambda_vpc_id:-}}"

# This sandbox account's TraineeSelfServiceIAM policy only allows
# iam:CreateRole when a matching permissions boundary is attached - every
# aws_iam_role resource in this config fails to create without it.
ROLE_PERMISSIONS_BOUNDARY_ARN="${ROLE_PERMISSIONS_BOUNDARY_ARN:-arn:aws:iam::208096650110:policy/TraineeSandboxBoundary}"

# The primary synthetic tenant - see backend/core-case-service/src/dev/localAuthConfig.ts.
# Baked into the SPA build; also the default tenant scripts/aws/bastion-run.sh
# seed/demo-seed writes to.
VITE_TENANT_ID="${VITE_TENANT_ID:-8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb}"
SKIP_SPA_DEPLOY="${SKIP_SPA_DEPLOY:-false}"
SKIP_BASTION_SEED="${SKIP_BASTION_SEED:-false}"
SKIP_ZAP_SCAN="${SKIP_ZAP_SCAN:-false}"

# Applies GL-coding's readonly database role and the "vector" extension
# (module.database_core_case's readonly_roles/extensions). This is on by
# default because GL-coding tasks cannot start without the generated readonly
# role secret. It opens its own SSM tunnel through the bastion, fetches the RDS
# master password itself (never via asm-exec; see run_readonly_role_step
# below), and tears the tunnel down when done, on success or failure.
RUN_READONLY_ROLE_STEP="${RUN_READONLY_ROLE_STEP:-true}"
READONLY_ROLE_STEP_LOCAL_PORT="${READONLY_ROLE_STEP_LOCAL_PORT:-15432}"

# Pinned by digest, matching TRIVY_IMAGE/SYFT_IMAGE in
# .github/workflows/secure-release-gate.yml.
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef}"

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

for tool in terraform sam docker aws openssl node jq; do
    require_tool "$tool"
done

if [[ "$RUN_READONLY_ROLE_STEP" == "true" ]]; then
    for tool in session-manager-plugin nc; do
        require_tool "$tool"
    done
fi

if [[ ! -d "$TERRAFORM_DIR" || ! -d "$ECR_TERRAFORM_DIR" || ! -f "scripts/aws/generate-sandbox-secrets.sh" ]]; then
    echo "Run this script from the repository root." >&2
    exit 1
fi

if [[ ! -f "$TERRAFORM_DIR/backend.hcl" ]]; then
    echo "$TERRAFORM_DIR/backend.hcl is required before deploying." >&2
    echo "Create it from $TERRAFORM_DIR/backend.hcl.example and set the Terraform state bucket." >&2
    exit 1
fi

apply_args=(-input=false)
if [[ "$AUTO_APPROVE" == "true" ]]; then
    apply_args+=(-auto-approve)
fi

terraform_apply() {
    terraform -chdir="$TERRAFORM_DIR" apply "${apply_args[@]}" \
        -var="aws_profile=$AWS_PROFILE" \
        "$@"
}

terraform_ecr_apply() {
    terraform -chdir="$ECR_TERRAFORM_DIR" apply "${apply_args[@]}" \
        -var="aws_profile=$AWS_PROFILE" \
        -var="aws_region=$AWS_REGION" \
        -var="name_prefix=$NAME_PREFIX" \
        "$@"
}

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

resolve_http_api_lambda_vpc_id() {
    if [[ -n "$HTTP_API_LAMBDA_VPC_ID" ]]; then
        echo "$HTTP_API_LAMBDA_VPC_ID"
        return
    fi

    local discovered_vpc_id describe_vpcs_error
    describe_vpcs_error="$(mktemp)"
    if ! discovered_vpc_id="$(aws_cli ec2 describe-vpcs \
        --filters "Name=tag:Name,Values=$EXISTING_VPC_NAME" "Name=tag:env,Values=sandbox" \
        --query "Vpcs[0].VpcId" \
        --output text 2>"$describe_vpcs_error")"; then
        echo "Could not query sandbox VPCs with AWS_PROFILE=$AWS_PROFILE in $AWS_REGION:" >&2
        cat "$describe_vpcs_error" >&2
        rm -f "$describe_vpcs_error"
        echo >&2
        echo "If the AWS error is RequestExpired, refresh the AWS profile credentials" >&2
        echo "and check that the local clock is synchronized before rerunning." >&2
        exit 1
    fi
    rm -f "$describe_vpcs_error"

    if [[ -z "$discovered_vpc_id" || "$discovered_vpc_id" == "None" ]]; then
        echo "Could not discover sandbox VPC by tags Name=$EXISTING_VPC_NAME and env=sandbox." >&2
        echo "Set HTTP_API_LAMBDA_VPC_ID or TF_VAR_http_api_lambda_vpc_id explicitly and rerun." >&2
        exit 1
    fi

    echo "$discovered_vpc_id"
}

initialize_ecr_terraform() {
    terraform -chdir="$ECR_TERRAFORM_DIR" init \
        -input=false \
        -reconfigure \
        -backend-config=../sandbox/backend.hcl
}

import_existing_ecr_repository() {
    local resource_address="$1"
    local repository_name="$2"

    if terraform -chdir="$ECR_TERRAFORM_DIR" state list "$resource_address" >/dev/null 2>&1; then
        echo "  $repository_name is already managed in Terraform state."
        return
    fi

    if ! aws_cli ecr describe-repositories --repository-names "$repository_name" >/dev/null 2>&1; then
        echo "  $repository_name does not exist yet; Terraform will create it."
        return
    fi

    echo "  Importing existing $repository_name into persistent ECR Terraform state."
    terraform -chdir="$ECR_TERRAFORM_DIR" import -input=false \
        -var="aws_profile=$AWS_PROFILE" \
        -var="aws_region=$AWS_REGION" \
        -var="name_prefix=$NAME_PREFIX" \
        "$resource_address" "$repository_name"
}

ecr_output() {
    terraform -chdir="$ECR_TERRAFORM_DIR" output -raw "$1"
}

HTTP_API_LAMBDA_VPC_ID="$(resolve_http_api_lambda_vpc_id)"
export TF_VAR_http_api_lambda_vpc_id="$HTTP_API_LAMBDA_VPC_ID"
echo "Issue Payment Lambda VPC: $HTTP_API_LAMBDA_VPC_ID"

echo "=== 1/7: Generating demo secrets ==="
secrets_output="$(AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" scripts/aws/generate-sandbox-secrets.sh)"
echo "$secrets_output"

extract_var() {
    local flag_name="$1"

    echo "$secrets_output" | grep -- "-var $flag_name=" | tail -1 | sed "s/.*-var $flag_name=//"
}

core_case_auth_jwt_private_key_secret_arn="$(extract_var core_case_auth_jwt_private_key_secret_arn)"
gl_coding_auth_jwt_public_keys_json_secret_arn="$(extract_var gl_coding_auth_jwt_public_keys_json_secret_arn)"
core_case_mfa_totp_secret_encryption_key_secret_arn="$(extract_var core_case_mfa_totp_secret_encryption_key_secret_arn)"
core_case_internal_command_token_secret_arn="$(extract_var core_case_internal_command_token_secret_arn)"

echo "=== 2/7: Deploying the shared JWT issuer stack ==="
AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" scripts/aws/package-jwt-issuer.sh
issuer_deploy_log="$(mktemp)"
AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" scripts/aws/deploy-jwt-issuer.sh | tee "$issuer_deploy_log"
http_api_jwt_issuer="$(tail -1 "$issuer_deploy_log")"
rm -f "$issuer_deploy_log"
echo "JWT issuer URL: $http_api_jwt_issuer"

echo "=== 3/7: Applying persistent ECR repositories ==="
initialize_ecr_terraform
import_existing_ecr_repository "aws_ecr_repository.core_case" "${NAME_PREFIX}-core-case-service"
import_existing_ecr_repository "aws_ecr_repository.gl_coding" "${NAME_PREFIX}-gl-coding-service"
import_existing_ecr_repository "aws_ecr_repository.stage_transition_consumer_lambda" "${NAME_PREFIX}-stage-transition-consumer-lambda"
terraform_ecr_apply

core_case_repository_name="$(ecr_output core_case_repository_name)"
core_case_repository_url="$(ecr_output core_case_repository_url)"
core_case_repository_arn="$(ecr_output core_case_repository_arn)"
gl_coding_repository_name="$(ecr_output gl_coding_repository_name)"
gl_coding_repository_url="$(ecr_output gl_coding_repository_url)"
stage_transition_lambda_repository_name="$(ecr_output stage_transition_lambda_repository_name)"
stage_transition_lambda_repository_url="$(ecr_output stage_transition_lambda_repository_url)"

echo "=== 4/7: Building and pushing images (tag: $IMAGE_TAG) ==="
# Cosign keyless (OIDC/Sigstore) signing needs an interactive browser flow
# and cannot run unattended, so this resolves a pre-generated key pair from
# Secrets Manager instead. The private key is written to a temp file only
# for the duration of the signing step and shredded immediately after.
cosign_key_file="$(mktemp)"
aws --profile "$AWS_PROFILE" --region "$AWS_REGION" secretsmanager get-secret-value \
    --secret-id expenseflow/sandbox/cosign/private-key --query SecretString --output text >"$cosign_key_file"
cosign_password="$(aws --profile "$AWS_PROFILE" --region "$AWS_REGION" secretsmanager get-secret-value \
    --secret-id expenseflow/sandbox/cosign/password --query SecretString --output text)"

cleanup_cosign_key() {
    shred -u "$cosign_key_file" 2>/dev/null || rm -f "$cosign_key_file"
}
trap cleanup_cosign_key EXIT

CORE_CASE_REPOSITORY="$core_case_repository_name" \
    GL_CODING_REPOSITORY="$gl_coding_repository_name" \
    IMAGE_TAG="$IMAGE_TAG" \
    AWS_PROFILE="$AWS_PROFILE" \
    AWS_REGION="$AWS_REGION" \
    ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
    COSIGN_KEY="$cosign_key_file" \
    COSIGN_PASSWORD="$cosign_password" \
    scripts/aws/build-push-images.sh

cleanup_cosign_key
trap - EXIT

LAMBDA_REPOSITORY="$stage_transition_lambda_repository_name" \
    IMAGE_TAG="$IMAGE_TAG" \
    AWS_PROFILE="$AWS_PROFILE" \
    AWS_REGION="$AWS_REGION" \
    ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
    scripts/aws/SCRUM-149/package-stage-transition-lambda.sh

core_case_image_uri="$core_case_repository_url:$IMAGE_TAG"
gl_coding_image_uri="$gl_coding_repository_url:$IMAGE_TAG"
stage_transition_lambda_image_uri="$stage_transition_lambda_repository_url:$IMAGE_TAG"

terraform_runtime_vars=(
    -var="http_api_jwt_issuer=$http_api_jwt_issuer"
    -var="core_case_internal_command_token_secret_arn=$core_case_internal_command_token_secret_arn"
    -var="core_case_auth_jwt_private_key_secret_arn=$core_case_auth_jwt_private_key_secret_arn"
    -var="gl_coding_auth_jwt_public_keys_json_secret_arn=$gl_coding_auth_jwt_public_keys_json_secret_arn"
    -var="core_case_mfa_totp_secret_encryption_key_secret_arn=$core_case_mfa_totp_secret_encryption_key_secret_arn"
    -var="role_permissions_boundary_arn=$ROLE_PERMISSIONS_BOUNDARY_ARN"
    -var="enable_nat_gateway=false"
    -var="db_enable_enhanced_monitoring=false"
    -var="allow_plain_http_public_api=true"
    -var="core_case_internal_routes_enabled=true"
    -var="core_case_repository_url=$core_case_repository_url"
    -var="core_case_repository_arn=$core_case_repository_arn"
    -var="gl_coding_repository_url=$gl_coding_repository_url"
    -var="stage_transition_lambda_repository_url=$stage_transition_lambda_repository_url"
    -var="core_case_image_uri=$core_case_image_uri"
    -var="gl_coding_image_uri=$gl_coding_image_uri"
    -var="stage_transition_lambda_image_uri=$stage_transition_lambda_image_uri"
)

tf_output() {
    terraform -chdir="$TERRAFORM_DIR" output -raw "$1"
}

state_has_postgresql_resources() {
    terraform -chdir="$TERRAFORM_DIR" state list 2>/dev/null \
        | grep -Eq 'module\.database_core_case\.postgresql_(role|grant|extension)\.'
}

run_terraform_apply_through_db_tunnel() {
    local bastion_instance_id core_case_db_host db_secret_arn tunnel_pid
    local tunnel_log apply_status tunnel_cleaned

    bastion_instance_id="$(tf_output bastion_instance_id)"
    core_case_db_host="$(tf_output core_case_db_endpoint | cut -d: -f1)"
    db_secret_arn="$(tf_output core_case_db_master_user_secret_arn)"

    tunnel_log="$(mktemp)"
    # `set -m` puts this background job in its own process group so cleanup
    # can kill it with `kill -- -PID` below. Without this, `aws ssm
    # start-session` and the `session-manager-plugin` child process it
    # spawns to actually hold the port-forward end up in the same group as
    # this script; killing only the `aws` PID leaves session-manager-plugin
    # running and the tunnel open.
    set -m
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" ssm start-session \
        --target "$bastion_instance_id" \
        --document-name AWS-StartPortForwardingSessionToRemoteHost \
        --parameters "{\"host\":[\"$core_case_db_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$READONLY_ROLE_STEP_LOCAL_PORT\"]}" \
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
    until nc -z localhost "$READONLY_ROLE_STEP_LOCAL_PORT" 2>/dev/null; do
        if ! kill -0 "$tunnel_pid" 2>/dev/null; then
            echo "Bastion SSM tunnel exited before it started listening:" >&2
            cat "$tunnel_log" >&2
            return 1
        fi
        if (( waited >= 30 )); then
            echo "Timed out waiting for the bastion SSM tunnel to start listening on localhost:$READONLY_ROLE_STEP_LOCAL_PORT." >&2
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # Fetches the RDS master password directly rather than via asm-exec (an
    # Agent Toolkit for AWS component not every environment has installed) -
    # this script is not an AI agent, so the "never let plaintext reach a
    # model's context" rule that pattern exists for does not apply here. The
    # password lives only in this function's local shell state and the child
    # terraform process's environment, never printed or logged. See
    # infra/terraform/README.md's "GL-Coding Readonly Role Requires Private
    # RDS Access" section.
    local db_secret db_password
    db_secret="$(aws --profile "$AWS_PROFILE" --region "$AWS_REGION" secretsmanager get-secret-value \
        --secret-id "$db_secret_arn" --query SecretString --output text)"
    db_password="$(echo "$db_secret" | jq -r .password)"
    unset db_secret

    apply_status=0
    PGUSER=core_case_admin PGPASSWORD="$db_password" \
        terraform_apply \
        -var="postgresql_provider_host=localhost" \
        -var="postgresql_provider_port=$READONLY_ROLE_STEP_LOCAL_PORT" \
        -var="db_readonly_roles_and_extensions_enabled=true" \
        "${terraform_runtime_vars[@]}" \
        || apply_status=$?
    unset db_password

    return "$apply_status"
}

echo "=== 5/7: Full terraform apply ==="
readonly_role_step_already_applied=false
if state_has_postgresql_resources; then
    if [[ "$RUN_READONLY_ROLE_STEP" != "true" ]]; then
        echo "Terraform state already contains PostgreSQL role/extension resources," >&2
        echo "so the full apply must refresh them through the bastion tunnel." >&2
        echo "Rerun with RUN_READONLY_ROLE_STEP=true, or omit the variable." >&2
        exit 1
    fi
    echo "PostgreSQL resources already exist in state; running full apply through the bastion tunnel."
    run_terraform_apply_through_db_tunnel
    readonly_role_step_already_applied=true
else
    terraform_apply \
        -var="db_readonly_roles_and_extensions_enabled=false" \
        "${terraform_runtime_vars[@]}"
fi

if [[ "$RUN_READONLY_ROLE_STEP" == "true" ]]; then
    if [[ "$readonly_role_step_already_applied" == "true" ]]; then
        echo "=== 5b/7: GL-coding readonly role + vector extension already refreshed in step 5 ==="
    else
        echo "=== 5b/7: Applying GL-coding readonly role + vector extension (bastion tunnel) ==="
        if run_terraform_apply_through_db_tunnel; then
            echo "Readonly role and extension applied."
        else
            echo "Readonly role/extension step failed - GL-coding's ECS tasks and" >&2
            echo "pgvector-backed policy retrieval will not work correctly. See" >&2
            echo "infra/terraform/README.md's GL-Coding troubleshooting entry." >&2
            exit 1
        fi
    fi
else
    echo "=== 5b/7: Skipping readonly role + vector extension step (RUN_READONLY_ROLE_STEP=false) ==="
fi

if [[ "$SKIP_SPA_DEPLOY" != "true" ]]; then
    echo "=== 6/7: Building and deploying the SPA ==="
    # CloudFront serves only the SPA. The built SPA points at API Gateway's
    # HTTPS execute-api origin, which proxies Core Case /v1 requests to the
    # public ALB without sending them through the SPA distribution fallback.
    api_base_url="$(tf_output core_case_api_gateway_base_url)"
    VITE_API_BASE_URL="$api_base_url" VITE_TENANT_ID="$VITE_TENANT_ID" \
        npm --workspace frontend/app run build

    spa_bucket="$(tf_output spa_bucket_name)"
    spa_domain="$(tf_output spa_cloudfront_domain_name)"
    spa_distribution_id="$(aws --profile "$AWS_PROFILE" --region "$AWS_REGION" cloudfront list-distributions \
        --query "DistributionList.Items[?DomainName=='$spa_domain'].Id | [0]" --output text)"

    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" s3 sync frontend/app/dist "s3://$spa_bucket" \
        --delete --cache-control 'public,max-age=3600'
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" s3 cp frontend/app/dist/index.html "s3://$spa_bucket/index.html" \
        --cache-control 'no-cache,no-store,must-revalidate' --content-type 'text/html'
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" cloudfront create-invalidation \
        --distribution-id "$spa_distribution_id" --paths '/*' >/dev/null
else
    echo "=== 6/7: Skipping SPA deploy (SKIP_SPA_DEPLOY=true) ==="
fi

if [[ "$SKIP_BASTION_SEED" != "true" ]]; then
    echo "=== 7/7: Migrating and seeding via the bastion ==="
    export BASTION_INSTANCE_ID="$(tf_output bastion_instance_id)"
    export CORE_CASE_DB_MASTER_USER_SECRET_ARN="$(tf_output core_case_db_master_user_secret_arn)"
    export CORE_CASE_DB_HOST="$(tf_output core_case_db_endpoint | cut -d: -f1)"
    export CORE_CASE_DB_NAME="core_case"
    export MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN="$core_case_mfa_totp_secret_encryption_key_secret_arn"
    export CORE_CASE_IMAGE_URI="$core_case_repository_url"
    export CORE_CASE_IMAGE_TAG="$IMAGE_TAG"
    export RECEIPT_STORAGE_BUCKET="$(tf_output receipt_storage_bucket_name)"

    scripts/aws/bastion-run.sh migrate
    scripts/aws/bastion-run.sh seed
    scripts/aws/bastion-run.sh demo-seed
else
    echo "=== 7/7: Skipping bastion migrate/seed/demo-seed (SKIP_BASTION_SEED=true) ==="
fi

if [[ "$SKIP_ZAP_SCAN" != "true" ]]; then
    echo "=== 8/8: Running ZAP baseline DAST scan ==="
    # Points at the live OpenAPI document, not the bare API URL - ZAP
    # imports it and actively calls every documented /v1/* route, which is
    # the only way this exercises Core Case's real API surface through the
    # same API Gateway origin used by the SPA. See scripts/ci/run-zap-baseline-gate.sh.
    zap_target="$(tf_output core_case_api_gateway_base_url)/v1/openapi.json"
    zap_report_path="evidence/secure-release-gate/core-case-service-zap-report.json"
    mkdir -p "$(dirname "$zap_report_path")"

    ZAP_IMAGE="$ZAP_IMAGE" scripts/ci/run-zap-baseline-gate.sh \
        --target "$zap_target" \
        --output "$zap_report_path"

    # Deferred past the summary below (not run inline here) so a High
    # finding still lets the operator see the ALB/CloudFront URLs and the
    # "nothing was torn down" warning - the environment is already fully
    # deployed and billing by this point regardless of the scan result.
    zap_severity_status=0
    scripts/ci/check-zap-baseline-severity.sh "$zap_report_path" || zap_severity_status=$?
else
    echo "=== 8/8: Skipping ZAP baseline scan (SKIP_ZAP_SCAN=true) ==="
    zap_severity_status=0
fi

bastion_instance_id="$(tf_output bastion_instance_id)"
core_case_db_host="$(tf_output core_case_db_endpoint | cut -d: -f1)"
core_case_db_master_user_secret_arn="$(tf_output core_case_db_master_user_secret_arn)"

echo
echo "Demo deploy complete."
echo "CloudFront SPA:        https://$(tf_output spa_cloudfront_domain_name)"
echo "Core Case API Gateway: $(tf_output core_case_api_gateway_base_url)"
echo "Core Case ALB:         http://$(tf_output public_alb_dns_name)"
echo "Image tag:             $IMAGE_TAG"
echo "Browser note:          The SPA uses API Gateway HTTPS; the public HTTP ALB remains a directly reachable sandbox origin."
if [[ "$SKIP_ZAP_SCAN" != "true" ]]; then
    echo "ZAP report:            evidence/secure-release-gate/core-case-service-zap-report.json"
fi
echo
echo "Nothing was torn down. This environment is running real, billed AWS resources."
echo
if [[ "$RUN_READONLY_ROLE_STEP" != "true" ]]; then
    echo "One step is not automated by default: GL-coding's least-privilege"
    echo "database role and the \"vector\" extension (needed for policy"
    echo "retrieval embeddings) need Terraform's postgresql provider to reach"
    echo "RDS directly, which only works from inside the VPC - this run had"
    echo "RUN_READONLY_ROLE_STEP=false, so those resources were"
    echo "skipped. GL-coding's ECS tasks and pgvector-backed policy retrieval"
    echo "will not work correctly until this step runs."
    echo
    echo "Simplest fix: re-run with RUN_READONLY_ROLE_STEP=true (needs AWS"
    echo "credentials with ssm:StartSession on the bastion; it opens its own"
    echo "tunnel and cleans it up when done):"
    echo
    echo "  RUN_READONLY_ROLE_STEP=true AUTO_APPROVE=true $0"
    echo
    echo "Or apply just that step by hand, without asm-exec - the tunnel stays"
    echo "open in a background shell, and postgresql_provider_host/port pass"
    echo "the tunnel address to Terraform as -var flags instead of editing"
    echo "providers.tf:"
    echo
    echo "  aws ssm start-session --profile $AWS_PROFILE \\"
    echo "    --target $bastion_instance_id \\"
    echo "    --document-name AWS-StartPortForwardingSessionToRemoteHost \\"
    echo "    --parameters '{\"host\":[\"$core_case_db_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"15432\"]}' &"
    echo
    echo "  # in a second shell:"
    echo "  PGUSER=core_case_admin \\"
    echo "  PGPASSWORD=\"\$(aws --profile $AWS_PROFILE secretsmanager get-secret-value \\"
    echo "    --secret-id $core_case_db_master_user_secret_arn \\"
    echo "    --query SecretString --output text | jq -r .password)\" \\"
    echo "    terraform -chdir=$TERRAFORM_DIR apply \\"
    echo "    -var=\"postgresql_provider_host=localhost\" \\"
    echo "    -var=\"postgresql_provider_port=15432\" \\"
    echo "    -var=\"db_readonly_roles_and_extensions_enabled=true\" \\"
    echo "    # ... plus this run's other -var flags (http_api_jwt_issuer, image URIs, etc.)"
    echo
    echo "See infra/terraform/README.md for full details."
fi

if [[ "$zap_severity_status" -ne 0 ]]; then
    echo
    echo "ZAP baseline scan found a High-severity finding - see" >&2
    echo "evidence/secure-release-gate/core-case-service-zap-report.json." >&2
    exit "$zap_severity_status"
fi
