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
VPC_ID="${VPC_ID:-vpc-07d74aa9f23a0a4d5}"
STAGE_TRANSITION_QUEUE_NAME="${STAGE_TRANSITION_QUEUE_NAME:-expenseflow-report-stage-transitioned-events}"
STAGE_TRANSITION_DLQ_NAME="${STAGE_TRANSITION_DLQ_NAME:-expenseflow-report-stage-transitioned-dlq}"
DATABASE_URL_SECRET_ID="${DATABASE_URL_SECRET_ID:-expenseflow/sandbox/core-case/database-url}"
ROLE_PERMISSIONS_BOUNDARY_ARN="${ROLE_PERMISSIONS_BOUNDARY_ARN:-}"

TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-149)
EC2_TAGS="ResourceType=security-group,Tags=[{Key=user,Value=amos-maddux},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-149}]"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

account_id() {
    aws_cli sts get-caller-identity --query Account --output text
}

aws_arn_prefix() {
    local caller_arn arn_label partition

    caller_arn="$(aws_cli sts get-caller-identity --query Arn --output text)"
    IFS=':' read -r arn_label partition _ <<<"$caller_arn"
    printf '%s:%s\n' "$arn_label" "$partition"
}

queue_url() {
    aws_cli sqs get-queue-url --queue-name "$1" --query QueueUrl --output text
}

queue_arn() {
    local url="$1"

    aws_cli sqs get-queue-attributes \
        --queue-url "$url" \
        --attribute-names QueueArn \
        --query 'Attributes.QueueArn' \
        --output text
}

secret_arn() {
    aws_cli secretsmanager describe-secret \
        --secret-id "$DATABASE_URL_SECRET_ID" \
        --query ARN \
        --output text
}

create_or_tag_log_group() {
    local log_group_arn

    log_group_arn="$(aws_arn_prefix):logs:$AWS_REGION:$(account_id):log-group:$LAMBDA_LOG_GROUP"
    aws_cli logs create-log-group --log-group-name "$LAMBDA_LOG_GROUP" 2>/dev/null || true
    aws_cli logs put-retention-policy --log-group-name "$LAMBDA_LOG_GROUP" --retention-in-days 14
    aws_cli logs tag-resource \
        --resource-arn "$log_group_arn" \
        --tags user=amos-maddux,env=sandbox,ticket=SCRUM-149
}

create_or_tag_security_group() {
    local group_id

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$LAMBDA_SECURITY_GROUP_NAME" \
        --query 'SecurityGroups[0].GroupId' \
        --output text)"

    if [[ "$group_id" == "None" ]]; then
        group_id="$(aws_cli ec2 create-security-group \
            --vpc-id "$VPC_ID" \
            --group-name "$LAMBDA_SECURITY_GROUP_NAME" \
            --description "SCRUM-149 stage-transition consumer Lambda security group." \
            --tag-specifications "$EC2_TAGS" \
            --query GroupId \
            --output text)"
    fi

    aws_cli ec2 create-tags --resources "$group_id" --tags "${TAGS[@]}"
    echo "$group_id"
}

create_or_tag_lambda_role() {
    local role_arn
    local trust_policy='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
    local create_role_args=(iam create-role --role-name "$LAMBDA_ROLE_NAME" --assume-role-policy-document "$trust_policy" --tags "${TAGS[@]}")

    if [[ -n "$ROLE_PERMISSIONS_BOUNDARY_ARN" ]]; then
        create_role_args+=(--permissions-boundary "$ROLE_PERMISSIONS_BOUNDARY_ARN")
    fi

    if ! role_arn="$(aws_cli iam get-role --role-name "$LAMBDA_ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null)"; then
        role_arn="$(aws_cli "${create_role_args[@]}" --query 'Role.Arn' --output text)"
    fi

    aws_cli iam tag-role --role-name "$LAMBDA_ROLE_NAME" --tags "${TAGS[@]}"
}

write_lambda_policy() {
    local policy_file="$1"
    local source_queue_arn="$2"
    local dead_letter_queue_arn="$3"
    local database_secret_arn="$4"

    ARN_PREFIX="$(aws_arn_prefix)" \
        ACCOUNT_ID="$(account_id)" \
        AWS_REGION="$AWS_REGION" \
        LAMBDA_LOG_GROUP="$LAMBDA_LOG_GROUP" \
        SOURCE_QUEUE_ARN="$source_queue_arn" \
        DEAD_LETTER_QUEUE_ARN="$dead_letter_queue_arn" \
        DATABASE_SECRET_ARN="$database_secret_arn" \
        node -e "
const fs = require('fs');
const arnPrefix = process.env.ARN_PREFIX;
const accountId = process.env.ACCOUNT_ID;
const region = process.env.AWS_REGION;
const logGroup = process.env.LAMBDA_LOG_GROUP;
const logGroupArn = arnPrefix + ':logs:' + region + ':' + accountId + ':log-group:' + logGroup + ':*';
fs.writeFileSync(process.argv[1], JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: logGroupArn
    },
    {
      Effect: 'Allow',
      Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility', 'sqs:GetQueueAttributes'],
      Resource: process.env.SOURCE_QUEUE_ARN
    },
    {
      Effect: 'Allow',
      Action: ['sqs:GetQueueAttributes'],
      Resource: process.env.DEAD_LETTER_QUEUE_ARN
    },
    {
      Effect: 'Allow',
      Action: ['secretsmanager:GetSecretValue'],
      Resource: process.env.DATABASE_SECRET_ARN
    },
    {
      Effect: 'Allow',
      Action: ['ec2:CreateNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DeleteNetworkInterface', 'ec2:AssignPrivateIpAddresses', 'ec2:UnassignPrivateIpAddresses'],
      Resource: '*'
    }
  ]
}, null, 2));
" "$policy_file"
}

main() {
    echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    aws_cli sts get-caller-identity >/dev/null

    source_queue_url="$(queue_url "$STAGE_TRANSITION_QUEUE_NAME")"
    dead_letter_queue_url="$(queue_url "$STAGE_TRANSITION_DLQ_NAME")"
    source_queue_arn="$(queue_arn "$source_queue_url")"
    dead_letter_queue_arn="$(queue_arn "$dead_letter_queue_url")"
    database_secret_arn="$(secret_arn)"

    echo "Creating or tagging Lambda log group..."
    create_or_tag_log_group

    echo "Creating or tagging Lambda security group..."
    lambda_security_group_id="$(create_or_tag_security_group)"

    echo "Creating or tagging Lambda execution role..."
    create_or_tag_lambda_role

    policy_file="$(mktemp)"
    write_lambda_policy "$policy_file" "$source_queue_arn" "$dead_letter_queue_arn" "$database_secret_arn"
    aws_cli iam put-role-policy \
        --role-name "$LAMBDA_ROLE_NAME" \
        --policy-name expenseflow-scrum-149-stage-transition-consumer \
        --policy-document "file://$policy_file"
    rm -f "$policy_file"

    echo "SCRUM-149 Lambda resources are ready."
    echo "Lambda role: $LAMBDA_ROLE_NAME"
    echo "Lambda security group ID: $lambda_security_group_id"
}

main "$@"
