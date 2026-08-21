#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
LAMBDA_REPOSITORY="${LAMBDA_REPOSITORY:-expenseflow-stage-transition-consumer-lambda}"
IMAGE_TAG="${IMAGE_TAG:-scrum-149-smoke}"

TAGS=(Key=user,Value=muhilramesh Key=env,Value=sandbox Key=ticket,Value=SCRUM-149)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

create_or_tag_ecr_repository() {
    local repository_name="$1"
    local repository_arn

    if ! repository_arn="$(aws_cli ecr describe-repositories --repository-names "$repository_name" --query 'repositories[0].repositoryArn' --output text 2>/dev/null)"; then
        repository_arn="$(aws_cli ecr create-repository \
            --repository-name "$repository_name" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256 \
            --tags "${TAGS[@]}" \
            --query 'repository.repositoryArn' \
            --output text)"
    fi

    aws_cli ecr tag-resource --resource-arn "$repository_arn" --tags "${TAGS[@]}"
}

main() {
    account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
    registry_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"
    image_uri="$registry_uri/$LAMBDA_REPOSITORY:$IMAGE_TAG"

    create_or_tag_ecr_repository "$LAMBDA_REPOSITORY"
    aws_cli ecr get-login-password | docker login --username AWS --password-stdin "$registry_uri"

    # --provenance=false --sbom=false: Lambda's CreateFunction rejects the
    # attestation manifest buildx otherwise attaches to the pushed image
    # ("image manifest, config or layer media type ... is not supported").
    docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --sbom=false \
        --file backend/core-case-service/Dockerfile.lambda \
        --tag "$image_uri" \
        --push \
        .

    echo "Pushed Lambda image repository $LAMBDA_REPOSITORY with tag $IMAGE_TAG."
}

main "$@"
