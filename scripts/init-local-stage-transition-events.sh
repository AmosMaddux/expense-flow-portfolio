#!/bin/sh

set -eu

topic_name="expenseflow-stage-transitions-local"
queue_name="expenseflow-stage-transition-events-local"
dlq_name="expenseflow-stage-transition-events-dlq-local"

topic_arn="$(
    awslocal sns create-topic \
        --name "$topic_name" \
        --query TopicArn \
        --output text
)"
dlq_url="$(
    awslocal sqs create-queue \
        --queue-name "$dlq_name" \
        --query QueueUrl \
        --output text
)"
dlq_arn="$(
    awslocal sqs get-queue-attributes \
        --queue-url "$dlq_url" \
        --attribute-names QueueArn \
        --query Attributes.QueueArn \
        --output text
)"
redrive_attributes_file="$(mktemp)"
trap 'rm -f "$redrive_attributes_file"' EXIT
cat >"$redrive_attributes_file" <<EOF
{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"$dlq_arn\",\"maxReceiveCount\":\"3\"}"
}
EOF
queue_url="$(
    awslocal sqs create-queue \
        --queue-name "$queue_name" \
        --attributes "file://$redrive_attributes_file" \
        --query QueueUrl \
        --output text
)"
awslocal sqs set-queue-attributes \
    --queue-url "$queue_url" \
    --attributes "file://$redrive_attributes_file"
configured_redrive_policy="$(
    awslocal sqs get-queue-attributes \
        --queue-url "$queue_url" \
        --attribute-names RedrivePolicy \
        --query Attributes.RedrivePolicy \
        --output text
)"
case "$configured_redrive_policy" in
    *"$dlq_arn"*'"maxReceiveCount":"3"'* | *"$dlq_arn"*'"maxReceiveCount":3'*)
        ;;
    *)
        echo "Stage-transition queue redrive policy was not configured." >&2
        echo "Expected DLQ ARN: $dlq_arn" >&2
        echo "Actual RedrivePolicy: $configured_redrive_policy" >&2
        exit 1
        ;;
esac
queue_arn="$(
    awslocal sqs get-queue-attributes \
        --queue-url "$queue_url" \
        --attribute-names QueueArn \
        --query Attributes.QueueArn \
        --output text
)"

# Raw delivery exposes the CloudEvent body directly when inspecting the queue.
awslocal sns subscribe \
    --topic-arn "$topic_arn" \
    --protocol sqs \
    --notification-endpoint "$queue_arn" \
    --attributes RawMessageDelivery=true \
    --output text >/dev/null
