#!/usr/bin/env bash
set -euo pipefail

# Deploys the shared JWT issuer stack (platform/http-api/issuer-template.yaml)
# that serves /.well-known/openid-configuration and /.well-known/jwks.json for
# the HTTP API's JWT authorizer (http_api_jwt_issuer). Run
# package-jwt-issuer.sh first.
#
# The JWKS it publishes is the public half of the Core Case JWT signing
# keypair. Pass it explicitly via JWKS_JSON, or leave it unset to read it
# from the Secrets Manager secret scripts/aws/generate-sandbox-secrets.sh
# publishes (gl_coding_auth_jwt_public_keys_json_secret_arn).
#
# On success, prints the IssuerUrl stack output — pass it as
# http_api_jwt_issuer on terraform apply.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

STACK_NAME="${STACK_NAME:-expenseflow-http-api-issuer-sandbox}"
TEMPLATE_FILE="${TEMPLATE_FILE:-.aws-sam/issuer-build/template.yaml}"
BOOTSTRAP_STACK_NAME="${BOOTSTRAP_STACK_NAME:-expenseflow-platform-bootstrap-sandbox}"
DEPLOYMENT_ARTIFACT_BUCKET="${DEPLOYMENT_ARTIFACT_BUCKET:-}"
JWKS_JSON="${JWKS_JSON:-}"
JWKS_SECRET_ID="${JWKS_SECRET_ID:-expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

resolve_deployment_artifact_bucket() {
    if [[ -n "$DEPLOYMENT_ARTIFACT_BUCKET" ]]; then
        echo "$DEPLOYMENT_ARTIFACT_BUCKET"
        return 0
    fi

    aws_cli cloudformation describe-stacks \
        --stack-name "$BOOTSTRAP_STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='DeploymentArtifactBucketName'].OutputValue | [0]" \
        --output text
}

resolve_jwks_json() {
    if [[ -n "$JWKS_JSON" ]]; then
        echo "$JWKS_JSON"
        return 0
    fi

    aws_cli secretsmanager get-secret-value \
        --secret-id "$JWKS_SECRET_ID" \
        --query SecretString \
        --output text
}

main() {
    if [[ ! -f "$TEMPLATE_FILE" ]]; then
        echo "Built SAM template is missing: $TEMPLATE_FILE. Run package-jwt-issuer.sh first." >&2
        exit 1
    fi

    deployment_artifact_bucket="$(resolve_deployment_artifact_bucket)"
    if [[ -z "$deployment_artifact_bucket" || "$deployment_artifact_bucket" == "None" ]]; then
        echo "Unable to resolve deployment artifact bucket. Set DEPLOYMENT_ARTIFACT_BUCKET or BOOTSTRAP_STACK_NAME." >&2
        exit 1
    fi

    resolved_jwks_json="$(resolve_jwks_json)"
    if [[ -z "$resolved_jwks_json" || "$resolved_jwks_json" == "None" ]]; then
        echo "Unable to resolve JWKS JSON. Set JWKS_JSON explicitly or run generate-sandbox-secrets.sh first." >&2
        exit 1
    fi

    # sam deploy's --parameter-overrides splits its value on characters that
    # also appear inside JSON (commas, colons, braces), silently truncating
    # JwksJson to just "{". aws cloudformation deploy's --parameter-overrides
    # file:// form parses a real JSON array instead of a delimited string, so
    # it round-trips the JWKS correctly.
    parameters_file="$(mktemp --suffix=.json)"
    trap 'rm -f "$parameters_file"; trap - RETURN EXIT' RETURN EXIT
    ENVIRONMENT_TAG="sandbox" USER_TAG="muhilramesh" JWKS_JSON_VALUE="$resolved_jwks_json" node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify([
  { ParameterKey: "EnvironmentTag", ParameterValue: process.env.ENVIRONMENT_TAG },
  { ParameterKey: "UserTag", ParameterValue: process.env.USER_TAG },
  { ParameterKey: "JwksJson", ParameterValue: process.env.JWKS_JSON_VALUE },
]));
' "$parameters_file"

    aws_cli cloudformation package \
        --template-file "$TEMPLATE_FILE" \
        --s3-bucket "$deployment_artifact_bucket" \
        --output-template-file "$parameters_file.packaged.yaml"

    aws_cli cloudformation deploy \
        --template-file "$parameters_file.packaged.yaml" \
        --stack-name "$STACK_NAME" \
        --capabilities CAPABILITY_IAM \
        --no-fail-on-empty-changeset \
        --tags user=muhilramesh env=sandbox ticket=SCRUM-156 \
        --parameter-overrides "file://$parameters_file"
    rm -f "$parameters_file.packaged.yaml"

    echo "Deployed JWT issuer stack $STACK_NAME."
    aws_cli cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='IssuerUrl'].OutputValue | [0]" \
        --output text
}

main "$@"
