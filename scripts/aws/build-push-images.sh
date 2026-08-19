#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
CORE_CASE_REPOSITORY="${CORE_CASE_REPOSITORY:-expenseflow-core-case-service}"
GL_CODING_REPOSITORY="${GL_CODING_REPOSITORY:-expenseflow-gl-coding-service}"
IMAGE_TAG="${IMAGE_TAG:-scrum-147-smoke}"
EVIDENCE_DIR="${SECURE_RELEASE_GATE_EVIDENCE_DIR:-evidence/secure-release-gate}"
TRIVY_BIN="${TRIVY_BIN:-trivy}"
SYFT_BIN="${SYFT_BIN:-syft}"
COSIGN_BIN="${COSIGN_BIN:-cosign}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

require_tool() {
    local tool="$1"

    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is required to build, scan, and sign release images. Install it before running this script." >&2
        exit 1
    fi
}

require_tool "$TRIVY_BIN"
require_tool "$SYFT_BIN"
require_tool "$COSIGN_BIN"

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

# Scans and signs a pushed image so only verified artifacts reach ECS.
# scripts/aws/verify-image-signatures.sh checks the resulting signature
# before register-task-definitions.sh renders a task definition against it.
scan_and_sign_image() {
    local image_uri="$1"
    local evidence_prefix="$2"

    "$TRIVY_BIN" image \
        --severity CRITICAL \
        --exit-code 1 \
        --ignorefile .trivyignore \
        --format json \
        --output "$EVIDENCE_DIR/$evidence_prefix-trivy-report.json" \
        "$image_uri"

    "$SYFT_BIN" "$image_uri" \
        -o "cyclonedx-json=$EVIDENCE_DIR/$evidence_prefix-sbom.cdx.json"

    "$COSIGN_BIN" sign --yes "$image_uri"
    "$COSIGN_BIN" attest --yes \
        --predicate "$EVIDENCE_DIR/$evidence_prefix-sbom.cdx.json" \
        --type cyclonedx \
        "$image_uri"
}

mkdir -p "$EVIDENCE_DIR"

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

scan_and_sign_image "$core_case_image_uri" "core-case-service"
scan_and_sign_image "$gl_coding_image_uri" "gl-coding-service"

echo "Scanned, SBOM'd, and signed $core_case_image_uri"
echo "Scanned, SBOM'd, and signed $gl_coding_image_uri"
echo "Evidence written to $EVIDENCE_DIR"
