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
#   3. Creates the three ECR repositories with a targeted apply, since a
#      Lambda with package_type=Image fails to create against an empty
#      repo, and this can't be worked around by variable defaults.
#   4. Builds and pushes Core Case, GL-coding, and the stage-transition
#      consumer Lambda images, tagged with the current UTC timestamp so
#      re-runs never collide with the ECR repositories' IMMUTABLE tag
#      setting.
#   5. Runs the full terraform apply with everything wired together. This
#      also creates the bastion (module.bastion).
#   6. Builds the SPA with VITE_TENANT_ID baked in and deploys it to the SPA
#      bucket + CloudFront.
#   7. Runs database migrations, seeds the ten synthetic sign-in accounts,
#      and seeds demo expense data, all via the bastion over SSM
#      (scripts/aws/bastion-run.sh) - no tunnel needed for any of these.
#
# What this script does NOT do: GL-coding's least-privilege database role
# (module.database_core_case's readonly_roles) needs Terraform's postgresql
# provider to reach RDS directly, which only works from inside the VPC. That
# needs an SSM tunnel through the bastion and is left as one manual step -
# this script prints the exact commands at the end.
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
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

NAME_PREFIX="${NAME_PREFIX:-expenseflow-sandbox}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
IMAGE_TAG="${IMAGE_TAG:-demo-$(date -u +%Y%m%dt%H%M%Sz)}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"

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

if [[ ! -d "$TERRAFORM_DIR" || ! -f "scripts/aws/generate-sandbox-secrets.sh" ]]; then
    echo "Run this script from the repository root." >&2
    exit 1
fi

apply_args=(-input=false)
if [[ "$AUTO_APPROVE" == "true" ]]; then
    apply_args+=(-auto-approve)
fi

terraform_apply() {
    terraform -chdir="$TERRAFORM_DIR" apply "${apply_args[@]}" "$@"
}

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

echo "=== 3/7: Creating ECR repositories (targeted apply) ==="
# Terraform validates every declared root variable has a value before it
# even looks at -target, regardless of whether the targeted resources
# actually depend on it - so every required variable must be passed here
# too, even ones the ECR repos themselves don't use.
terraform_apply \
    -var="http_api_jwt_issuer=$http_api_jwt_issuer" \
    -var="core_case_internal_command_token_secret_arn=$core_case_internal_command_token_secret_arn" \
    -var="role_permissions_boundary_arn=$ROLE_PERMISSIONS_BOUNDARY_ARN" \
    -var="enable_nat_gateway=false" \
    -var="db_enable_enhanced_monitoring=false" \
    -target=module.ecs.aws_ecr_repository.core_case \
    -target=module.ecs.aws_ecr_repository.gl_coding \
    -target=module.lambda_stage_transition_consumer.aws_ecr_repository.this

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

CORE_CASE_REPOSITORY="${NAME_PREFIX}-core-case-service" \
    GL_CODING_REPOSITORY="${NAME_PREFIX}-gl-coding-service" \
    IMAGE_TAG="$IMAGE_TAG" \
    AWS_PROFILE="$AWS_PROFILE" \
    AWS_REGION="$AWS_REGION" \
    ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
    COSIGN_KEY="$cosign_key_file" \
    COSIGN_PASSWORD="$cosign_password" \
    scripts/aws/build-push-images.sh

cleanup_cosign_key
trap - EXIT

LAMBDA_REPOSITORY="${NAME_PREFIX}-stage-transition-consumer-lambda" \
    IMAGE_TAG="$IMAGE_TAG" \
    AWS_PROFILE="$AWS_PROFILE" \
    AWS_REGION="$AWS_REGION" \
    ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
    scripts/aws/SCRUM-149/package-stage-transition-lambda.sh

account_id="$(aws --profile "$AWS_PROFILE" --region "$AWS_REGION" sts get-caller-identity --query Account --output text)"
registry_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"
core_case_image_uri="$registry_uri/${NAME_PREFIX}-core-case-service:$IMAGE_TAG"
gl_coding_image_uri="$registry_uri/${NAME_PREFIX}-gl-coding-service:$IMAGE_TAG"
stage_transition_lambda_image_uri="$registry_uri/${NAME_PREFIX}-stage-transition-consumer-lambda:$IMAGE_TAG"

echo "=== 5/7: Full terraform apply ==="
terraform_apply \
    -var="http_api_jwt_issuer=$http_api_jwt_issuer" \
    -var="core_case_internal_command_token_secret_arn=$core_case_internal_command_token_secret_arn" \
    -var="core_case_auth_jwt_private_key_secret_arn=$core_case_auth_jwt_private_key_secret_arn" \
    -var="gl_coding_auth_jwt_public_keys_json_secret_arn=$gl_coding_auth_jwt_public_keys_json_secret_arn" \
    -var="core_case_mfa_totp_secret_encryption_key_secret_arn=$core_case_mfa_totp_secret_encryption_key_secret_arn" \
    -var="role_permissions_boundary_arn=$ROLE_PERMISSIONS_BOUNDARY_ARN" \
    -var="enable_nat_gateway=false" \
    -var="db_enable_enhanced_monitoring=false" \
    -var="allow_plain_http_public_api=true" \
    -var="core_case_internal_routes_enabled=true" \
    -var="core_case_image_uri=$core_case_image_uri" \
    -var="gl_coding_image_uri=$gl_coding_image_uri" \
    -var="stage_transition_lambda_image_uri=$stage_transition_lambda_image_uri"

tf_output() {
    terraform -chdir="$TERRAFORM_DIR" output -raw "$1"
}

if [[ "$SKIP_SPA_DEPLOY" != "true" ]]; then
    echo "=== 6/7: Building and deploying the SPA ==="
    # VITE_API_BASE_URL is deliberately left unset/empty so the SPA calls the
    # API with a relative path, which CloudFront proxies to the ALB
    # (module.spa's ordered_cache_behavior for /v1/*) - this keeps the
    # browser talking HTTPS-only to CloudFront even though the ALB itself
    # has no certificate. The repo-root .env sets VITE_API_BASE_URL for
    # local docker-compose dev and Vite loads it by default; the explicit
    # empty assignment here overrides that for this build.
    VITE_API_BASE_URL="" VITE_TENANT_ID="$VITE_TENANT_ID" \
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
    export CORE_CASE_IMAGE_URI="$core_case_image_uri"
    export CORE_CASE_IMAGE_TAG="$IMAGE_TAG"
    export RECEIPT_STORAGE_BUCKET="$(tf_output receipt_storage_bucket_name)"

    scripts/aws/bastion-run.sh migrate
    scripts/aws/bastion-run.sh seed
    scripts/aws/bastion-run.sh demo-seed
else
    echo "=== 7/7: Skipping bastion migrate/seed/demo-seed (SKIP_BASTION_SEED=true) ==="
fi

bastion_instance_id="$(tf_output bastion_instance_id)"
core_case_db_host="$(tf_output core_case_db_endpoint | cut -d: -f1)"
core_case_db_master_user_secret_arn="$(tf_output core_case_db_master_user_secret_arn)"

echo
echo "Demo deploy complete."
echo "Public ALB:    http://$(tf_output public_alb_dns_name)"
echo "CloudFront:    https://$(tf_output spa_cloudfront_domain_name)"
echo "Image tag:     $IMAGE_TAG"
echo
echo "Nothing was torn down. This environment is running real, billed AWS resources."
echo
echo "One step is not automated: GL-coding's least-privilege database role"
echo "needs Terraform's postgresql provider to reach RDS directly, which only"
echo "works from inside the VPC. Tunnel through the bastion, then apply:"
echo
echo "  aws ssm start-session --profile $AWS_PROFILE \\"
echo "    --target $bastion_instance_id \\"
echo "    --document-name AWS-StartPortForwardingSessionToRemoteHost \\"
echo "    --parameters '{\"host\":[\"$core_case_db_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"15432\"]}'"
echo
echo "  # in providers.tf, temporarily set the postgresql provider's"
echo "  # host = \"localhost\" and port = 15432, then revert before committing"
echo "  PGUSER=core_case_admin \\"
echo "  PGPASSWORD='{{resolve:secretsmanager:$core_case_db_master_user_secret_arn:SecretString:password}}' \\"
echo "    asm-exec -- terraform -chdir=$TERRAFORM_DIR apply"
echo
echo "See infra/terraform/README.md for full details."
