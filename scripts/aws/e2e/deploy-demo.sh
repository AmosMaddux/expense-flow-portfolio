#!/usr/bin/env bash
set -euo pipefail

# One-command demo deploy for the Terraform-managed sandbox
# (infra/terraform/environments/sandbox). Runs everything a fresh apply
# needs in order:
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
#   5. Runs the full terraform apply with everything wired together.
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

for tool in terraform sam docker aws openssl node; do
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

echo "=== 1/5: Generating demo secrets ==="
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

echo "=== 2/5: Deploying the shared JWT issuer stack ==="
AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" scripts/aws/package-jwt-issuer.sh
issuer_deploy_log="$(mktemp)"
AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" scripts/aws/deploy-jwt-issuer.sh | tee "$issuer_deploy_log"
http_api_jwt_issuer="$(tail -1 "$issuer_deploy_log")"
rm -f "$issuer_deploy_log"
echo "JWT issuer URL: $http_api_jwt_issuer"

echo "=== 3/5: Creating ECR repositories (targeted apply) ==="
terraform_apply \
    -target=module.ecs.aws_ecr_repository.core_case \
    -target=module.ecs.aws_ecr_repository.gl_coding \
    -target=module.lambda_stage_transition_consumer.aws_ecr_repository.this

echo "=== 4/5: Building and pushing images (tag: $IMAGE_TAG) ==="
CORE_CASE_REPOSITORY="${NAME_PREFIX}-core-case-service" \
    GL_CODING_REPOSITORY="${NAME_PREFIX}-gl-coding-service" \
    IMAGE_TAG="$IMAGE_TAG" \
    AWS_PROFILE="$AWS_PROFILE" \
    AWS_REGION="$AWS_REGION" \
    ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
    scripts/aws/build-push-images.sh

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

echo "=== 5/5: Full terraform apply ==="
terraform_apply \
    -var="http_api_jwt_issuer=$http_api_jwt_issuer" \
    -var="core_case_internal_command_token_secret_arn=$core_case_internal_command_token_secret_arn" \
    -var="core_case_auth_jwt_private_key_secret_arn=$core_case_auth_jwt_private_key_secret_arn" \
    -var="gl_coding_auth_jwt_public_keys_json_secret_arn=$gl_coding_auth_jwt_public_keys_json_secret_arn" \
    -var="core_case_mfa_totp_secret_encryption_key_secret_arn=$core_case_mfa_totp_secret_encryption_key_secret_arn" \
    -var="allow_plain_http_public_api=true" \
    -var="core_case_internal_routes_enabled=true" \
    -var="core_case_image_uri=$core_case_image_uri" \
    -var="gl_coding_image_uri=$gl_coding_image_uri" \
    -var="stage_transition_lambda_image_uri=$stage_transition_lambda_image_uri"

echo
echo "Demo deploy complete."
echo "Public ALB:    http://$(terraform -chdir="$TERRAFORM_DIR" output -raw public_alb_dns_name)"
echo "CloudFront:    https://$(terraform -chdir="$TERRAFORM_DIR" output -raw spa_cloudfront_domain_name)"
echo "Image tag:     $IMAGE_TAG"
echo
echo "Nothing was torn down. This environment is running real, billed AWS resources."
