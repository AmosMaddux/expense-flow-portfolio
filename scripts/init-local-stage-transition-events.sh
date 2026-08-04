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
queue_url="$(
    awslocal sqs create-queue \
        --queue-name "$queue_name" \
        --attributes "RedrivePolicy={\"deadLetterTargetArn\":\"$dlq_arn\",\"maxReceiveCount\":\"3\"}" \
        --query QueueUrl \
        --output text
)"
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
