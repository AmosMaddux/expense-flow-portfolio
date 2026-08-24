#!/usr/bin/env bash
set -euo pipefail

# Builds the shared JWT issuer Lambda (platform/http-api/issuer-template.yaml)
# for deployment. Run deploy-jwt-issuer.sh afterward.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
TEMPLATE_FILE="${TEMPLATE_FILE:-platform/http-api/issuer-template.yaml}"
BUILD_DIR="${BUILD_DIR:-.aws-sam/issuer-build}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

main() {
    npm --workspace platform/http-api run build:lambda

    sam validate --template-file "$TEMPLATE_FILE"
    sam build \
        --template-file "$TEMPLATE_FILE" \
        --build-dir "$BUILD_DIR" \
        --region "$AWS_REGION"

    echo "Packaged JWT issuer Lambda artifacts with $TEMPLATE_FILE."
}

main "$@"
