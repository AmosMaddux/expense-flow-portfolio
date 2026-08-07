#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
CORE_CASE_REPOSITORY="${CORE_CASE_REPOSITORY:-expenseflow-core-case-service}"
GL_CODING_REPOSITORY="${GL_CODING_REPOSITORY:-expenseflow-gl-coding-service}"
IMAGE_TAG="${IMAGE_TAG:-scrum-147-smoke}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
registry_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"
core_case_image_uri="$registry_uri/$CORE_CASE_REPOSITORY:$IMAGE_TAG"
gl_coding_image_uri="$registry_uri/$GL_CODING_REPOSITORY:$IMAGE_TAG"

aws_cli ecr get-login-password | docker login --username AWS --password-stdin "$registry_uri"

docker buildx build \
    --platform linux/amd64 \
    --file backend/core-case-service/Dockerfile \
    --tag "$core_case_image_uri" \
    --push \
    .

docker buildx build \
    --platform linux/amd64 \
    --file backend/python/Dockerfile \
    --tag "$gl_coding_image_uri" \
    --push \
    .

echo "Pushed $core_case_image_uri"
echo "Pushed $gl_coding_image_uri"
