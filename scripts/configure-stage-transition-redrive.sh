#!/bin/sh

set -eu

: "${STAGE_TRANSITION_SQS_QUEUE_URL:?STAGE_TRANSITION_SQS_QUEUE_URL is required}"

dlq_name="${STAGE_TRANSITION_SQS_DLQ_NAME:-expenseflow-stage-transition-events-dlq}"
max_receive_count="${STAGE_TRANSITION_SQS_MAX_RECEIVE_COUNT:-3}"

aws_sqs() {
    if [ -n "${STAGE_TRANSITION_SQS_ENDPOINT:-}" ]; then
        aws sqs --endpoint-url "$STAGE_TRANSITION_SQS_ENDPOINT" "$@"
        return
    fi

    aws sqs "$@"
}

dlq_url="$(
    aws_sqs create-queue \
        --queue-name "$dlq_name" \
        --query QueueUrl \
        --output text
)"
dlq_arn="$(
    aws_sqs get-queue-attributes \
        --queue-url "$dlq_url" \
        --attribute-names QueueArn \
        --query Attributes.QueueArn \
        --output text
)"
redrive_attributes_file="$(mktemp)"
trap 'rm -f "$redrive_attributes_file"' EXIT
cat >"$redrive_attributes_file" <<EOF
{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"$dlq_arn\",\"maxReceiveCount\":\"$max_receive_count\"}"
}
EOF

aws_sqs set-queue-attributes \
    --queue-url "$STAGE_TRANSITION_SQS_QUEUE_URL" \
    --attributes "file://$redrive_attributes_file"

configured_redrive_policy="$(
    aws_sqs get-queue-attributes \
        --queue-url "$STAGE_TRANSITION_SQS_QUEUE_URL" \
        --attribute-names RedrivePolicy \
        --query Attributes.RedrivePolicy \
        --output text
)"
case "$configured_redrive_policy" in
    *"$dlq_arn"*'"maxReceiveCount":"'"$max_receive_count"'"'* | *"$dlq_arn"*'"maxReceiveCount":'"$max_receive_count"*)
        ;;
    *)
        echo "Stage-transition queue redrive policy was not configured." >&2
        echo "Expected DLQ ARN: $dlq_arn" >&2
        echo "Expected maxReceiveCount: $max_receive_count" >&2
        echo "Actual RedrivePolicy: $configured_redrive_policy" >&2
        exit 1
        ;;
esac

printf '%s\n' "$configured_redrive_policy"
