#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

STACK_NAME="${STACK_NAME:-expenseflow-issue-payment-http-api-sandbox}"
TEMPLATE_FILE="${TEMPLATE_FILE:-.aws-sam/issue-payment-build/template.yaml}"
HTTP_API_ID="${HTTP_API_ID:-}"
HTTP_API_STACK_NAME="${HTTP_API_STACK_NAME:-expenseflow-http-api-sandbox}"
BOOTSTRAP_STACK_NAME="${BOOTSTRAP_STACK_NAME:-expenseflow-platform-bootstrap-sandbox}"
DEPLOYMENT_ARTIFACT_BUCKET="${DEPLOYMENT_ARTIFACT_BUCKET:-}"
SHARED_JWT_AUTHORIZER_ID="${SHARED_JWT_AUTHORIZER_ID:-}"
STAGE_NAME="${STAGE_NAME:-v1}"
ISSUE_PAYMENT_FUNCTION_NAME="${ISSUE_PAYMENT_FUNCTION_NAME:-expenseflow-issue-payment-stub}"
CORE_CASE_INTERNAL_BASE_URL="${CORE_CASE_INTERNAL_BASE_URL:-}"
CORE_CASE_INTERNAL_COMMAND_TOKEN="${CORE_CASE_INTERNAL_COMMAND_TOKEN:-}"
CORE_CASE_INTERNAL_TIMEOUT_MS="${CORE_CASE_INTERNAL_TIMEOUT_MS:-5000}"
ROLE_PERMISSIONS_BOUNDARY_ARN="${ROLE_PERMISSIONS_BOUNDARY_ARN:-}"
PRIVATE_SUBNETS="${PRIVATE_SUBNETS:-}"
LAMBDA_SECURITY_GROUP_ID="${LAMBDA_SECURITY_GROUP_ID:-}"
VPC_ID="${VPC_ID:-}"
LAMBDA_SECURITY_GROUP_NAME="${LAMBDA_SECURITY_GROUP_NAME:-expenseflow-issue-payment-lambda-sg}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied before deploying SCRUM-150 Issue Payment Lambda." >&2
        return 1
    fi
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

resolve_security_group_id() {
    if [[ -n "$LAMBDA_SECURITY_GROUP_ID" ]]; then
        echo "$LAMBDA_SECURITY_GROUP_ID"
        return 0
    fi

    if [[ -z "$VPC_ID" ]]; then
        return 0
    fi

    aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$LAMBDA_SECURITY_GROUP_NAME" \
        --query 'SecurityGroups[0].GroupId' \
        --output text
}

main() {
    require_non_empty ROLE_PERMISSIONS_BOUNDARY_ARN "$ROLE_PERMISSIONS_BOUNDARY_ARN"
    require_non_empty CORE_CASE_INTERNAL_BASE_URL "$CORE_CASE_INTERNAL_BASE_URL"
    require_non_empty CORE_CASE_INTERNAL_COMMAND_TOKEN "$CORE_CASE_INTERNAL_COMMAND_TOKEN"

    if [[ ! -f "$TEMPLATE_FILE" ]]; then
        echo "Built SAM template is missing: $TEMPLATE_FILE. Run package-issue-payment-lambda.sh first." >&2
        exit 1
    fi

    resolved_http_api_id="$(resolve_http_api_id)"
    resolved_authorizer_id="$(resolve_authorizer_id "$resolved_http_api_id")"
    if [[ -z "$resolved_http_api_id" || "$resolved_http_api_id" == "None" ]]; then
        echo "Unable to resolve HTTP API ID. Set HTTP_API_ID or HTTP_API_STACK_NAME." >&2
        exit 1
    fi
    if [[ -z "$resolved_authorizer_id" || "$resolved_authorizer_id" == "None" ]]; then
        echo "Unable to resolve shared JWT authorizer for HTTP API $resolved_http_api_id." >&2
        exit 1
    fi

    resolved_security_group_id="$(resolve_security_group_id)"
    if [[ -n "$PRIVATE_SUBNETS" && ( -z "$resolved_security_group_id" || "$resolved_security_group_id" == "None" ) ]]; then
        echo "PRIVATE_SUBNETS requires LAMBDA_SECURITY_GROUP_ID or a SCRUM-150 security group created with VPC_ID." >&2
        exit 1
    fi
    if [[ -n "$resolved_security_group_id" && "$resolved_security_group_id" != "None" && -z "$PRIVATE_SUBNETS" ]]; then
        echo "LAMBDA_SECURITY_GROUP_ID requires PRIVATE_SUBNETS for Lambda VPC config." >&2
        exit 1
    fi

    deployment_artifact_bucket="$(resolve_deployment_artifact_bucket)"
    if [[ -z "$deployment_artifact_bucket" || "$deployment_artifact_bucket" == "None" ]]; then
        echo "Unable to resolve deployment artifact bucket. Set DEPLOYMENT_ARTIFACT_BUCKET or BOOTSTRAP_STACK_NAME." >&2
        exit 1
    fi

    parameter_overrides=(
        "EnvironmentTag=sandbox"
        "UserTag=muhilramesh"
        "TicketTag=SCRUM-150"
        "HttpApiId=$resolved_http_api_id"
        "SharedJwtAuthorizerId=$resolved_authorizer_id"
        "StageName=$STAGE_NAME"
        "IssuePaymentFunctionName=$ISSUE_PAYMENT_FUNCTION_NAME"
        "CoreCaseInternalBaseUrl=$CORE_CASE_INTERNAL_BASE_URL"
        "CoreCaseInternalCommandToken=$CORE_CASE_INTERNAL_COMMAND_TOKEN"
        "CoreCaseInternalTimeoutMs=$CORE_CASE_INTERNAL_TIMEOUT_MS"
        "RolePermissionsBoundaryArn=$ROLE_PERMISSIONS_BOUNDARY_ARN"
    )

    if [[ -n "$PRIVATE_SUBNETS" ]]; then
        parameter_overrides+=(
            "PrivateSubnetIds=$PRIVATE_SUBNETS"
            "LambdaSecurityGroupIds=$resolved_security_group_id"
        )
    fi

    sam deploy \
        --template-file "$TEMPLATE_FILE" \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --capabilities CAPABILITY_IAM \
        --s3-bucket "$deployment_artifact_bucket" \
        --no-fail-on-empty-changeset \
        --tags user=muhilramesh env=sandbox ticket=SCRUM-150 \
        --parameter-overrides "${parameter_overrides[@]}"

    echo "Deployed SCRUM-150 Issue Payment Lambda stack $STACK_NAME."
}

main "$@"
