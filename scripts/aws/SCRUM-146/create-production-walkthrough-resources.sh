#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="${EXPECTED_PROFILE:-expenseflow-production}"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_PRODUCTION_PROFILE="${ALLOW_NON_PRODUCTION_PROFILE:-false}"
ENV_FILE="${ENV_FILE:-.env}"
ALLOW_AWS_ENDPOINT_OVERRIDES="${ALLOW_AWS_ENDPOINT_OVERRIDES:-false}"

STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-production-stage-transitions}"
STAGE_TRANSITION_SQS_QUEUE_NAME="${STAGE_TRANSITION_SQS_QUEUE_NAME:-expenseflow-production-stage-transition-events}"
STAGE_TRANSITION_SQS_DLQ_NAME="${STAGE_TRANSITION_SQS_DLQ_NAME:-expenseflow-production-stage-transition-events-dlq}"
STAGE_TRANSITION_SQS_MAX_RECEIVE_COUNT="${STAGE_TRANSITION_SQS_MAX_RECEIVE_COUNT:-3}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-production-expense-report}"
DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX:-expenseflow-production-expense-report-tenant-index}"

TAGS=(Key=product,Value=ExpenseFlow Key=env,Value=production Key=ticket,Value=SCRUM-146)
SQS_TAGS="product=ExpenseFlow,env=production,ticket=SCRUM-146"

load_env_file() {
    if [[ ! -f "$ENV_FILE" ]]; then
        return
    fi

    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
}

load_env_file

if [[ "$ALLOW_AWS_ENDPOINT_OVERRIDES" != "true" ]]; then
    unset AWS_ENDPOINT_URL
    unset AWS_ENDPOINT_URL_DYNAMODB
    unset AWS_ENDPOINT_URL_SNS
    unset AWS_ENDPOINT_URL_SQS
fi

if [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
    AWS_PROFILE=""
fi

if [[ -n "$AWS_PROFILE" && "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_PRODUCTION_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_PRODUCTION_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    if [[ -n "$AWS_PROFILE" ]]; then
        aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
        return
    fi

    aws --region "$AWS_REGION" "$@"
}

account_id() {
    aws_cli sts get-caller-identity --query Account --output text
}

create_or_tag_sns_topic() {
    local topic_name="$1"
    local topic_arn

    topic_arn="$(aws_cli sns create-topic \
        --name "$topic_name" \
        --tags "${TAGS[@]}" \
        --query TopicArn \
        --output text)"
    aws_cli sns tag-resource --resource-arn "$topic_arn" --tags "${TAGS[@]}"
    echo "$topic_arn"
}

create_or_tag_sqs_queue() {
    local queue_name="$1"
    local queue_url

    queue_url="$(aws_cli sqs create-queue \
        --queue-name "$queue_name" \
        --tags "$SQS_TAGS" \
        --query QueueUrl \
        --output text)"
    aws_cli sqs tag-queue --queue-url "$queue_url" --tags "$SQS_TAGS"
    echo "$queue_url"
}

queue_arn() {
    local queue_url="$1"

    aws_cli sqs get-queue-attributes \
        --queue-url "$queue_url" \
        --attribute-names QueueArn \
        --query 'Attributes.QueueArn' \
        --output text
}

configure_queue_redrive() {
    local queue_url="$1"
    local dlq_arn="$2"
    local attributes_file

    attributes_file="$(mktemp)"
    DLQ_ARN="$dlq_arn" MAX_RECEIVE_COUNT="$STAGE_TRANSITION_SQS_MAX_RECEIVE_COUNT" node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({
  RedrivePolicy: JSON.stringify({
    deadLetterTargetArn: process.env.DLQ_ARN,
    maxReceiveCount: Number(process.env.MAX_RECEIVE_COUNT)
  })
}));
" "$attributes_file"
    aws_cli sqs set-queue-attributes \
        --queue-url "$queue_url" \
        --attributes "file://$attributes_file"
    rm -f "$attributes_file"
}

allow_sns_to_send_to_queue() {
    local queue_url="$1"
    local queue_arn="$2"
    local topic_arn="$3"
    local attributes_file

    attributes_file="$(mktemp)"
    QUEUE_ARN="$queue_arn" TOPIC_ARN="$topic_arn" node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({
  Policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Sid: 'AllowExpenseFlowStageTransitionTopic',
      Effect: 'Allow',
      Principal: { Service: 'sns.amazonaws.com' },
      Action: 'sqs:SendMessage',
      Resource: process.env.QUEUE_ARN,
      Condition: {
        ArnEquals: {
          'aws:SourceArn': process.env.TOPIC_ARN
        }
      }
    }]
  })
}));
" "$attributes_file"
    aws_cli sqs set-queue-attributes \
        --queue-url "$queue_url" \
        --attributes "file://$attributes_file"
    rm -f "$attributes_file"
}

subscribe_queue_to_topic() {
    local topic_arn="$1"
    local queue_arn="$2"
    local subscription_arn

    subscription_arn="$(aws_cli sns list-subscriptions-by-topic \
        --topic-arn "$topic_arn" \
        --query "Subscriptions[?Endpoint=='$queue_arn'].SubscriptionArn | [0]" \
        --output text)"

    if [[ -z "$subscription_arn" || "$subscription_arn" == "None" ]]; then
        subscription_arn="$(aws_cli sns subscribe \
            --topic-arn "$topic_arn" \
            --protocol sqs \
            --notification-endpoint "$queue_arn" \
            --attributes RawMessageDelivery=true \
            --query SubscriptionArn \
            --output text)"
    fi

    aws_cli sns set-subscription-attributes \
        --subscription-arn "$subscription_arn" \
        --attribute-name RawMessageDelivery \
        --attribute-value true
    echo "$subscription_arn"
}

create_or_tag_expense_report_table() {
    local table_name="$1"
    local tenant_index_name="$2"
    local table_arn

    table_arn="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query 'Table.TableArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$table_arn" || "$table_arn" == "None" ]]; then
        table_arn="$(aws_cli dynamodb create-table \
            --table-name "$table_name" \
            --attribute-definitions \
                AttributeName=tenantId,AttributeType=S \
                AttributeName=id,AttributeType=S \
                AttributeName=currentStage,AttributeType=S \
            --key-schema \
                AttributeName=tenantId,KeyType=HASH \
                AttributeName=id,KeyType=RANGE \
            --global-secondary-indexes \
                "IndexName=$tenant_index_name,KeySchema=[{AttributeName=tenantId,KeyType=HASH},{AttributeName=currentStage,KeyType=RANGE}],Projection={ProjectionType=INCLUDE,NonKeyAttributes=[dueDate]}" \
            --billing-mode PAY_PER_REQUEST \
            --tags "${TAGS[@]}" \
            --query 'TableDescription.TableArn' \
            --output text)"
        aws_cli dynamodb wait table-exists --table-name "$table_name"
    fi

    if [[ -z "$table_arn" || "$table_arn" == "None" ]]; then
        echo "Could not resolve DynamoDB table ARN for $table_name." >&2
        return 1
    fi

    aws_cli dynamodb tag-resource --resource-arn "$table_arn" --tags "${TAGS[@]}"
    echo "$table_arn"
}

main() {
    if [[ -n "$AWS_PROFILE" ]]; then
        echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    else
        echo "Verifying AWS identity from environment session credentials in $AWS_REGION..."
    fi
    aws_cli sts get-caller-identity >/dev/null

    echo "Creating or tagging SNS topic..."
    topic_arn="$(create_or_tag_sns_topic "$STAGE_TRANSITION_SNS_TOPIC_NAME")"

    echo "Creating or tagging SQS queues..."
    dlq_url="$(create_or_tag_sqs_queue "$STAGE_TRANSITION_SQS_DLQ_NAME")"
    dlq_arn="$(queue_arn "$dlq_url")"
    queue_url="$(create_or_tag_sqs_queue "$STAGE_TRANSITION_SQS_QUEUE_NAME")"
    queue_arn_value="$(queue_arn "$queue_url")"

    echo "Configuring SQS redrive and SNS delivery policy..."
    configure_queue_redrive "$queue_url" "$dlq_arn"
    allow_sns_to_send_to_queue "$queue_url" "$queue_arn_value" "$topic_arn"

    echo "Subscribing SQS queue to SNS topic..."
    subscription_arn="$(subscribe_queue_to_topic "$topic_arn" "$queue_arn_value")"

    echo "Creating or tagging DynamoDB Expense Report table..."
    table_arn="$(create_or_tag_expense_report_table "$DYNAMODB_EXPENSE_REPORT_TABLE" "$DYNAMODB_EXPENSE_REPORT_TENANT_INDEX")"

    cat <<EOF
SCRUM-146 production walkthrough resources are ready.

export AWS_REGION="$AWS_REGION"
export STAGE_TRANSITION_SNS_TOPIC_ARN="$topic_arn"
export STAGE_TRANSITION_SQS_QUEUE_URL="$queue_url"
export STAGE_TRANSITION_SQS_DLQ_URL="$dlq_url"
export DYNAMODB_EXPENSE_REPORT_TABLE="$DYNAMODB_EXPENSE_REPORT_TABLE"
export DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="$DYNAMODB_EXPENSE_REPORT_TENANT_INDEX"

SNS subscription: $subscription_arn
DynamoDB table ARN: $table_arn
AWS account: $(account_id)
EOF
}

main "$@"
