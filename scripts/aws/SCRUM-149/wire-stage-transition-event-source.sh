#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

FUNCTION_NAME="${FUNCTION_NAME:-expenseflow-stage-transition-consumer}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"
STAGE_TRANSITION_QUEUE_NAME="${STAGE_TRANSITION_QUEUE_NAME:-expenseflow-sandbox-stage-transition-events}"
STAGE_TRANSITION_DLQ_NAME="${STAGE_TRANSITION_DLQ_NAME:-expenseflow-sandbox-stage-transition-events-dlq}"
BATCH_SIZE="${BATCH_SIZE:-10}"

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
        --query "Topics[?ends_with(TopicArn, ':$STAGE_TRANSITION_SNS_TOPIC_NAME')].TopicArn | [0]" \
        --output text
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

main() {
    source_queue_url="$(queue_url "$STAGE_TRANSITION_QUEUE_NAME")"
    dead_letter_queue_url="$(queue_url "$STAGE_TRANSITION_DLQ_NAME")"
    source_queue_arn="$(queue_attribute "$source_queue_url" QueueArn)"
    dead_letter_queue_arn="$(queue_attribute "$dead_letter_queue_url" QueueArn)"
    stage_transition_topic_arn="$(topic_arn)"

    if [[ -z "$stage_transition_topic_arn" || "$stage_transition_topic_arn" == "None" ]]; then
        echo "Missing SNS topic: $STAGE_TRANSITION_SNS_TOPIC_NAME" >&2
        exit 1
    fi

    require_redrive_to_dlq "$source_queue_url" "$dead_letter_queue_arn"

    mapping_uuid="$(aws_cli lambda list-event-source-mappings \
        --function-name "$FUNCTION_NAME" \
        --event-source-arn "$source_queue_arn" \
        --query 'EventSourceMappings[0].UUID' \
        --output text 2>/dev/null || true)"

    if [[ -z "$mapping_uuid" || "$mapping_uuid" == "None" ]]; then
        mapping_uuid="$(aws_cli lambda create-event-source-mapping \
            --function-name "$FUNCTION_NAME" \
            --event-source-arn "$source_queue_arn" \
            --batch-size "$BATCH_SIZE" \
            --function-response-types ReportBatchItemFailures \
            --enabled \
            --query UUID \
            --output text)"
    else
        aws_cli lambda update-event-source-mapping \
            --uuid "$mapping_uuid" \
            --function-name "$FUNCTION_NAME" \
            --batch-size "$BATCH_SIZE" \
            --function-response-types ReportBatchItemFailures \
            --enabled >/dev/null
    fi

    echo "Wired $STAGE_TRANSITION_QUEUE_NAME to $FUNCTION_NAME with event source mapping $mapping_uuid"
    echo "Verified SNS topic exists: $STAGE_TRANSITION_SNS_TOPIC_NAME"
}

main "$@"
