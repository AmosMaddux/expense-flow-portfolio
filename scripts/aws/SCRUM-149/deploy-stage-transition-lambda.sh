#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

FUNCTION_NAME="${FUNCTION_NAME:-expenseflow-stage-transition-consumer}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-expenseflow-stage-transition-consumer-lambda-role}"
LAMBDA_SECURITY_GROUP_NAME="${LAMBDA_SECURITY_GROUP_NAME:-expenseflow-stage-transition-consumer-lambda-sg}"
LAMBDA_LOG_GROUP="${LAMBDA_LOG_GROUP:-/aws/lambda/$FUNCTION_NAME}"
LAMBDA_REPOSITORY="${LAMBDA_REPOSITORY:-expenseflow-stage-transition-consumer-lambda}"
IMAGE_TAG="${IMAGE_TAG:-scrum-149-smoke}"
VPC_ID="${VPC_ID:-vpc-07d74aa9f23a0a4d5}"
PRIVATE_SUBNETS="${PRIVATE_SUBNETS:-subnet-0aefa6933acb130d5,subnet-0f35fcc094f77ec8b}"
DATABASE_URL_SECRET_ID="${DATABASE_URL_SECRET_ID:-expenseflow/sandbox/core-case/database-url}"
LAMBDA_TIMEOUT_SECONDS="${LAMBDA_TIMEOUT_SECONDS:-30}"
LAMBDA_MEMORY_SIZE="${LAMBDA_MEMORY_SIZE:-512}"

TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-149)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

role_arn() {
    aws_cli iam get-role --role-name "$LAMBDA_ROLE_NAME" --query 'Role.Arn' --output text
}

security_group_id() {
    aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$LAMBDA_SECURITY_GROUP_NAME" \
        --query 'SecurityGroups[0].GroupId' \
        --output text
}

tag_function() {
    local function_arn="$1"

    aws_cli lambda tag-resource --resource "$function_arn" --tags user=amos-maddux,env=sandbox,ticket=SCRUM-149
}

main() {
    account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
    image_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com/$LAMBDA_REPOSITORY:$IMAGE_TAG"
    lambda_role_arn="$(role_arn)"
    lambda_security_group_id="$(security_group_id)"

    if [[ -z "$lambda_security_group_id" || "$lambda_security_group_id" == "None" ]]; then
        echo "Missing Lambda security group. Run create-stage-transition-lambda-resources.sh first." >&2
        exit 1
    fi

    if aws_cli lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
        aws_cli lambda update-function-code \
            --function-name "$FUNCTION_NAME" \
            --image-uri "$image_uri" >/dev/null
        aws_cli lambda wait function-updated --function-name "$FUNCTION_NAME"
        aws_cli lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --role "$lambda_role_arn" \
            --timeout "$LAMBDA_TIMEOUT_SECONDS" \
            --memory-size "$LAMBDA_MEMORY_SIZE" \
            --environment "Variables={AWS_REGION=$AWS_REGION,DATABASE_URL_SECRET_ID=$DATABASE_URL_SECRET_ID}" \
            --vpc-config "SubnetIds=$PRIVATE_SUBNETS,SecurityGroupIds=$lambda_security_group_id" >/dev/null
        aws_cli lambda wait function-updated --function-name "$FUNCTION_NAME"
    else
        aws_cli lambda create-function \
            --function-name "$FUNCTION_NAME" \
            --package-type Image \
            --code ImageUri="$image_uri" \
            --role "$lambda_role_arn" \
            --architectures x86_64 \
            --timeout "$LAMBDA_TIMEOUT_SECONDS" \
            --memory-size "$LAMBDA_MEMORY_SIZE" \
            --environment "Variables={AWS_REGION=$AWS_REGION,DATABASE_URL_SECRET_ID=$DATABASE_URL_SECRET_ID}" \
            --vpc-config "SubnetIds=$PRIVATE_SUBNETS,SecurityGroupIds=$lambda_security_group_id" \
            --tags user=amos-maddux,env=sandbox,ticket=SCRUM-149 >/dev/null
        aws_cli lambda wait function-active --function-name "$FUNCTION_NAME"
    fi

    aws_cli logs create-log-group --log-group-name "$LAMBDA_LOG_GROUP" 2>/dev/null || true
    aws_cli logs put-retention-policy --log-group-name "$LAMBDA_LOG_GROUP" --retention-in-days 14
    function_arn="$(aws_cli lambda get-function --function-name "$FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text)"
    tag_function "$function_arn"

    echo "Deployed Lambda function $FUNCTION_NAME with image $image_uri"
}

main "$@"
