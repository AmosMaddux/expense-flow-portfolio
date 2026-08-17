#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

HTTP_API_ID="${HTTP_API_ID:-}"
HTTP_API_STACK_NAME="${HTTP_API_STACK_NAME:-expenseflow-http-api-sandbox}"
SHARED_JWT_AUTHORIZER_ID="${SHARED_JWT_AUTHORIZER_ID:-}"
SHARED_JWT_AUTHORIZER_NAME="${SHARED_JWT_AUTHORIZER_NAME:-SharedJwtAuthorizer}"
JWT_ISSUER="${JWT_ISSUER:-}"
JWT_AUDIENCE="${JWT_AUDIENCE:-}"
VPC_ID="${VPC_ID:-}"
LAMBDA_SECURITY_GROUP_ID="${LAMBDA_SECURITY_GROUP_ID:-}"
LAMBDA_SECURITY_GROUP_NAME="${LAMBDA_SECURITY_GROUP_NAME:-expenseflow-issue-payment-lambda-sg}"

TAGS=(Key=user,Value=muhilramesh Key=env,Value=sandbox Key=ticket,Value=SCRUM-150)
EC2_TAGS="ResourceType=security-group,Tags=[{Key=user,Value=muhilramesh},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-150}]"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

resolve_http_api_id() {
    if [[ -n "$HTTP_API_ID" ]]; then
        echo "$HTTP_API_ID"
        return 0
    fi

    aws_cli cloudformation describe-stacks \
        --stack-name "$HTTP_API_STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='HttpApiId'].OutputValue | [0]" \
        --output text
}

resolve_stack_parameter() {
    local parameter_key="$1"

    aws_cli cloudformation describe-stacks \
        --stack-name "$HTTP_API_STACK_NAME" \
        --query "Stacks[0].Parameters[?ParameterKey=='$parameter_key'].ParameterValue | [0]" \
        --output text
}

resolve_jwt_issuer() {
    if [[ -n "$JWT_ISSUER" ]]; then
        echo "$JWT_ISSUER"
        return 0
    fi

    resolve_stack_parameter JwtIssuer
}

resolve_jwt_audience() {
    if [[ -n "$JWT_AUDIENCE" ]]; then
        echo "$JWT_AUDIENCE"
        return 0
    fi

    resolve_stack_parameter JwtAudience
}

resolve_authorizer_id() {
    local http_api_id="$1"
    local expected_issuer="$2"
    local expected_audience="$3"
    local authorizers_json

    if [[ -n "$SHARED_JWT_AUTHORIZER_ID" ]]; then
        authorizers_json="$(aws_cli apigatewayv2 get-authorizer \
            --api-id "$http_api_id" \
            --authorizer-id "$SHARED_JWT_AUTHORIZER_ID" \
            --output json)"
    else
        authorizers_json="$(aws_cli apigatewayv2 get-authorizers \
            --api-id "$http_api_id" \
            --query "Items[?AuthorizerType=='JWT']" \
            --output json)"
    fi

    AUTHORIZERS_JSON="$authorizers_json" \
        EXPECTED_AUTHORIZER_ID="$SHARED_JWT_AUTHORIZER_ID" \
        EXPECTED_AUTHORIZER_NAME="$SHARED_JWT_AUTHORIZER_NAME" \
        EXPECTED_JWT_ISSUER="$expected_issuer" \
        EXPECTED_JWT_AUDIENCE="$expected_audience" \
        node --input-type=module -e '
const raw = JSON.parse(process.env.AUTHORIZERS_JSON || "null");
const authorizers = Array.isArray(raw) ? raw : [raw];
const matches = authorizers.filter((authorizer) => {
  const config = authorizer?.JwtConfiguration ?? {};
  const audience = Array.isArray(config.Audience) ? config.Audience : [];
  return authorizer?.AuthorizerType === "JWT" &&
    (!process.env.EXPECTED_AUTHORIZER_ID || authorizer.AuthorizerId === process.env.EXPECTED_AUTHORIZER_ID) &&
    authorizer?.Name === process.env.EXPECTED_AUTHORIZER_NAME &&
    config.Issuer === process.env.EXPECTED_JWT_ISSUER &&
    audience.includes(process.env.EXPECTED_JWT_AUDIENCE);
});
if (matches.length !== 1) {
  throw new Error("Expected exactly one shared JWT authorizer with the configured name, issuer, and audience.");
}
process.stdout.write(matches[0].AuthorizerId);
'
}

create_or_tag_security_group() {
    local group_id

    if [[ -n "$LAMBDA_SECURITY_GROUP_ID" ]]; then
        aws_cli ec2 create-tags --resources "$LAMBDA_SECURITY_GROUP_ID" --tags "${TAGS[@]}"
        echo "$LAMBDA_SECURITY_GROUP_ID"
        return 0
    fi

    if [[ -z "$VPC_ID" ]]; then
        return 0
    fi

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$LAMBDA_SECURITY_GROUP_NAME" \
        --query 'SecurityGroups[0].GroupId' \
        --output text)"

    if [[ "$group_id" == "None" ]]; then
        group_id="$(aws_cli ec2 create-security-group \
            --vpc-id "$VPC_ID" \
            --group-name "$LAMBDA_SECURITY_GROUP_NAME" \
            --description "SCRUM-150 Issue Payment Lambda security group" \
            --tag-specifications "$EC2_TAGS" \
            --query GroupId \
            --output text)"
    fi

    aws_cli ec2 create-tags --resources "$group_id" --tags "${TAGS[@]}"
    echo "$group_id"
}

main() {
    echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    aws_cli sts get-caller-identity >/dev/null

    resolved_http_api_id="$(resolve_http_api_id)"
    if [[ -z "$resolved_http_api_id" || "$resolved_http_api_id" == "None" ]]; then
        echo "Unable to resolve HTTP API ID. Set HTTP_API_ID or HTTP_API_STACK_NAME." >&2
        exit 1
    fi

    expected_jwt_issuer="$(resolve_jwt_issuer)"
    expected_jwt_audience="$(resolve_jwt_audience)"
    if [[ -z "$expected_jwt_issuer" || "$expected_jwt_issuer" == "None" || -z "$expected_jwt_audience" || "$expected_jwt_audience" == "None" ]]; then
        echo "Unable to resolve JWT issuer/audience. Set JWT_ISSUER and JWT_AUDIENCE or provide HTTP_API_STACK_NAME." >&2
        exit 1
    fi

    resolved_authorizer_id="$(resolve_authorizer_id "$resolved_http_api_id" "$expected_jwt_issuer" "$expected_jwt_audience")"
    if [[ -z "$resolved_authorizer_id" || "$resolved_authorizer_id" == "None" ]]; then
        echo "Unable to resolve a shared JWT authorizer for HTTP API $resolved_http_api_id." >&2
        exit 1
    fi

    lambda_security_group_id="$(create_or_tag_security_group)"

    echo "SCRUM-150 shared HTTP API inputs are ready."
    echo "HTTP_API_ID=$resolved_http_api_id"
    echo "SHARED_JWT_AUTHORIZER_ID=$resolved_authorizer_id"
    if [[ -n "$lambda_security_group_id" ]]; then
        echo "LAMBDA_SECURITY_GROUP_ID=$lambda_security_group_id"
    fi
}

main "$@"
