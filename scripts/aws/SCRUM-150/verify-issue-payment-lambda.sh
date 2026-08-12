#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

FUNCTION_NAME="${FUNCTION_NAME:-expenseflow-issue-payment-stub}"
STACK_NAME="${STACK_NAME:-expenseflow-issue-payment-http-api-sandbox}"
HTTP_API_ID="${HTTP_API_ID:-}"
HTTP_API_STACK_NAME="${HTTP_API_STACK_NAME:-expenseflow-http-api-sandbox}"
SHARED_JWT_AUTHORIZER_ID="${SHARED_JWT_AUTHORIZER_ID:-}"
EXPECTED_ROUTE_KEY="POST /expense-reports/{id}/settlement"
LAMBDA_LOG_GROUP="${LAMBDA_LOG_GROUP:-/aws/lambda/$FUNCTION_NAME}"

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

resolve_authorizer_id() {
    local http_api_id="$1"

    if [[ -n "$SHARED_JWT_AUTHORIZER_ID" ]]; then
        echo "$SHARED_JWT_AUTHORIZER_ID"
        return 0
    fi

    aws_cli apigatewayv2 get-authorizers \
        --api-id "$http_api_id" \
        --query "Items[?AuthorizerType=='JWT'].AuthorizerId | [0]" \
        --output text
}

resolve_issue_payment_route_id() {
    aws_cli cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='IssuePaymentRouteId'].OutputValue | [0]" \
        --output text
}

require_true() {
    local condition="$1"
    local message="$2"

    if [[ "$condition" != "True" ]]; then
        echo "$message" >&2
        exit 1
    fi
}

require_lambda_environment_safe() {
    local environment_json="$1"

    ENVIRONMENT_JSON="$environment_json" node --input-type=module -e '
const variables = JSON.parse(process.env.ENVIRONMENT_JSON || "{}");
const required = [
  "CORE_CASE_INTERNAL_BASE_URL",
  "CORE_CASE_INTERNAL_COMMAND_TOKEN",
  "CORE_CASE_INTERNAL_TIMEOUT_MS"
];
for (const key of required) {
  if (!(key in variables)) {
    throw new Error(`Missing required Lambda environment variable: ${key}`);
  }
}
for (const key of Object.keys(variables)) {
  if (key === "DATABASE_URL" || key === "DATABASE_URL_SECRET_ID" || key.includes("DATABASE")) {
    throw new Error(`Forbidden database environment variable is present: ${key}`);
  }
}
'
}

require_role_has_no_secret_access() {
    local role_name="$1"
    local policy_names policy_document

    policy_names="$(aws_cli iam list-role-policies \
        --role-name "$role_name" \
        --query 'PolicyNames[]' \
        --output text)"

    for policy_name in $policy_names; do
        policy_document="$(aws_cli iam get-role-policy \
            --role-name "$role_name" \
            --policy-name "$policy_name" \
            --query PolicyDocument \
            --output json)"
        POLICY_DOCUMENT="$policy_document" node --input-type=module -e '
const policy = JSON.stringify(JSON.parse(process.env.POLICY_DOCUMENT || "{}"));
if (policy.includes("secretsmanager:GetSecretValue")) {
  throw new Error("Issue Payment Lambda role must not allow secretsmanager:GetSecretValue.");
}
if (!policy.includes("logs:CreateLogStream") || !policy.includes("logs:PutLogEvents")) {
  throw new Error("Issue Payment Lambda role must include least-privilege log permissions.");
}
'
    done
}

main() {
    resolved_http_api_id="$(resolve_http_api_id)"
    resolved_authorizer_id="$(resolve_authorizer_id "$resolved_http_api_id")"

    function_state="$(aws_cli lambda get-function \
        --function-name "$FUNCTION_NAME" \
        --query 'Configuration.State' \
        --output text)"
    if [[ "$function_state" != "Active" ]]; then
        echo "Expected Lambda function to be Active, got $function_state." >&2
        exit 1
    fi

    function_arn="$(aws_cli lambda get-function \
        --function-name "$FUNCTION_NAME" \
        --query 'Configuration.FunctionArn' \
        --output text)"
    role_arn="$(aws_cli lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --query Role \
        --output text)"
    role_name="${role_arn##*/}"

    lambda_tags_valid="$(aws_cli lambda list-tags \
        --resource "$function_arn" \
        --query "Tags.user == 'muhilramesh' && Tags.env == 'sandbox' && Tags.ticket == 'SCRUM-150'" \
        --output text)"
    require_true "$lambda_tags_valid" "Issue Payment Lambda ownership tags are missing."

    environment_json="$(aws_cli lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --query 'Environment.Variables' \
        --output json)"
    require_lambda_environment_safe "$environment_json"

    route_id="$(resolve_issue_payment_route_id)"
    if [[ -z "$route_id" || "$route_id" == "None" ]]; then
        echo "Unable to resolve SCRUM-150 Issue Payment route ID from $STACK_NAME." >&2
        exit 1
    fi

    route_json="$(aws_cli apigatewayv2 get-route \
        --api-id "$resolved_http_api_id" \
        --route-id "$route_id" \
        --output json)"
    actual_route_key="$(ROUTE_JSON="$route_json" node --input-type=module -e '
const route = JSON.parse(process.env.ROUTE_JSON || "null");
console.log(route?.RouteKey ?? "");
')"
    if [[ "$actual_route_key" != "$EXPECTED_ROUTE_KEY" ]]; then
        echo "Issue Payment route key is not the expected settlement route." >&2
        exit 1
    fi

    ROUTE_JSON="$route_json" EXPECTED_AUTHORIZER_ID="$resolved_authorizer_id" node --input-type=module -e '
const route = JSON.parse(process.env.ROUTE_JSON || "null");
if (route === null) throw new Error("Issue Payment route is missing.");
if (route.AuthorizationType !== "JWT") throw new Error("Issue Payment route must use JWT authorization.");
if (route.AuthorizerId !== process.env.EXPECTED_AUTHORIZER_ID) {
  throw new Error("Issue Payment route does not use the expected shared JWT authorizer.");
}
if (typeof route.Target !== "string" || !route.Target.startsWith("integrations/")) {
  throw new Error("Issue Payment route target is missing an integration.");
}
'
    integration_id="$(ROUTE_JSON="$route_json" node --input-type=module -e '
const route = JSON.parse(process.env.ROUTE_JSON || "{}");
console.log(String(route.Target || "").replace(/^integrations\//, ""));
')"
    integration_uri="$(aws_cli apigatewayv2 get-integration \
        --api-id "$resolved_http_api_id" \
        --integration-id "$integration_id" \
        --query IntegrationUri \
        --output text)"
    if [[ "$integration_uri" != "$function_arn" ]]; then
        echo "Issue Payment route integration does not target $FUNCTION_NAME." >&2
        exit 1
    fi

    retention_days="$(aws_cli logs describe-log-groups \
        --log-group-name-prefix "$LAMBDA_LOG_GROUP" \
        --query "logGroups[?logGroupName=='$LAMBDA_LOG_GROUP'].retentionInDays | [0]" \
        --output text)"
    if [[ "$retention_days" != "14" ]]; then
        echo "Expected log group retention to be 14 days, got $retention_days." >&2
        exit 1
    fi

    require_role_has_no_secret_access "$role_name"

    echo "SCRUM-150 Issue Payment Lambda verification passed."
    echo "Function: $FUNCTION_NAME ($function_state)"
    echo "HTTP API: $resolved_http_api_id"
    echo "Route: $EXPECTED_ROUTE_KEY"
}

main "$@"
