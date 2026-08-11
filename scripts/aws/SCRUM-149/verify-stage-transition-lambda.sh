#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

FUNCTION_NAME="${FUNCTION_NAME:-expenseflow-stage-transition-consumer}"
STAGE_TRANSITION_TOPIC_NAME="${STAGE_TRANSITION_TOPIC_NAME:-expenseflow-report-stage-transitioned-v1}"
STAGE_TRANSITION_QUEUE_NAME="${STAGE_TRANSITION_QUEUE_NAME:-expenseflow-report-stage-transitioned-events}"
STAGE_TRANSITION_DLQ_NAME="${STAGE_TRANSITION_DLQ_NAME:-expenseflow-report-stage-transitioned-dlq}"
PUBLISH_SYNTHETIC_EVENT="${PUBLISH_SYNTHETIC_EVENT:-false}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

queue_url() {
    aws_cli sqs get-queue-url --queue-name "$1" --query QueueUrl --output text
}

queue_attribute() {
    local url="$1"
    local attribute_name="$2"

    aws_cli sqs get-queue-attributes \
        --queue-url "$url" \
        --attribute-names "$attribute_name" \
        --query "Attributes.$attribute_name" \
        --output text
}

topic_arn() {
    aws_cli sns list-topics \
        --query "Topics[?ends_with(TopicArn, ':$STAGE_TRANSITION_TOPIC_NAME')].TopicArn | [0]" \
        --output text
}

require_mapping_enabled() {
    local source_queue_arn="$1"
    local mapping_state

    mapping_state="$(aws_cli lambda list-event-source-mappings \
        --function-name "$FUNCTION_NAME" \
        --event-source-arn "$source_queue_arn" \
        --query 'EventSourceMappings[0].State' \
        --output text)"

    if [[ "$mapping_state" != "Enabled" ]]; then
        echo "Expected event source mapping to be Enabled, got $mapping_state." >&2
        return 1
    fi
}

require_redrive_to_dlq() {
    local source_queue_url="$1"
    local dead_letter_queue_arn="$2"
    local redrive_policy

    redrive_policy="$(queue_attribute "$source_queue_url" RedrivePolicy)"
    REDRIVE_POLICY="$redrive_policy" DEAD_LETTER_QUEUE_ARN="$dead_letter_queue_arn" node -e "
const policy = JSON.parse(process.env.REDRIVE_POLICY || '{}');
if (policy.deadLetterTargetArn !== process.env.DEAD_LETTER_QUEUE_ARN) {
  throw new Error('Stage-transition queue redrive policy does not target the expected DLQ.');
}
if (Number(policy.maxReceiveCount) < 1) {
  throw new Error('Stage-transition queue redrive policy needs a positive maxReceiveCount.');
}
"
}

publish_synthetic_event() {
    local stage_transition_topic_arn="$1"
    local message_file

    message_file="$(mktemp)"
    node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({
  specversion: '1.0',
  type: 'com.expenseflow.expense-report.stage-transitioned.v1',
  source: 'urn:expenseflow:core-case-service',
  id: '40000000-0000-4000-8000-000000000149',
  time: '2026-08-11T14:30:00.000Z',
  subject: 'expense-reports/30000000-0000-4000-8000-000000000149',
  datacontenttype: 'application/json',
  dataschema: 'urn:expenseflow:schema:events:expense-report-stage-transitioned:v1',
  correlationid: '50000000-0000-4000-8000-000000000149',
  data: {
    caseId: '30000000-0000-4000-8000-000000000149',
    tenantId: '10000000-0000-4000-8000-000000000149',
    fromStage: 'Submitted',
    toStage: 'Manager Approval',
    correlationId: '50000000-0000-4000-8000-000000000149'
  }
}));
" "$message_file"

    aws_cli sns publish \
        --topic-arn "$stage_transition_topic_arn" \
        --message "file://$message_file" \
        --message-attributes '{"eventType":{"DataType":"String","StringValue":"com.expenseflow.expense-report.stage-transitioned.v1"},"correlationId":{"DataType":"String","StringValue":"50000000-0000-4000-8000-000000000149"}}' >/dev/null
    rm -f "$message_file"
}

main() {
    function_state="$(aws_cli lambda get-function \
        --function-name "$FUNCTION_NAME" \
        --query 'Configuration.State' \
        --output text)"
    if [[ "$function_state" != "Active" ]]; then
        echo "Expected Lambda function to be Active, got $function_state." >&2
        exit 1
    fi

    source_queue_url="$(queue_url "$STAGE_TRANSITION_QUEUE_NAME")"
    dead_letter_queue_url="$(queue_url "$STAGE_TRANSITION_DLQ_NAME")"
    source_queue_arn="$(queue_attribute "$source_queue_url" QueueArn)"
    dead_letter_queue_arn="$(queue_attribute "$dead_letter_queue_url" QueueArn)"
    stage_transition_topic_arn="$(topic_arn)"

    if [[ -z "$stage_transition_topic_arn" || "$stage_transition_topic_arn" == "None" ]]; then
        echo "Missing SNS topic: $STAGE_TRANSITION_TOPIC_NAME" >&2
        exit 1
    fi

    require_mapping_enabled "$source_queue_arn"
    require_redrive_to_dlq "$source_queue_url" "$dead_letter_queue_arn"

    if [[ "$PUBLISH_SYNTHETIC_EVENT" == "true" ]]; then
        publish_synthetic_event "$stage_transition_topic_arn"
        echo "Published one synthetic stage-transition event to $STAGE_TRANSITION_TOPIC_NAME."
    fi

    echo "SCRUM-149 Lambda verification passed."
    echo "Function: $FUNCTION_NAME ($function_state)"
    echo "Queue: $source_queue_arn"
    echo "DLQ: $dead_letter_queue_arn"
    echo "Topic: $stage_transition_topic_arn"
}

main "$@"
