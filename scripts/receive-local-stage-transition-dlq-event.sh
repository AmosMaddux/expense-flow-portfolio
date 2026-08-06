#!/bin/sh

set -eu

queue_url="$(
    docker compose exec -T localstack \
        awslocal sqs get-queue-url \
        --queue-name expenseflow-stage-transition-events-dlq-local \
        --query QueueUrl \
        --output text
)"

docker compose exec -T localstack \
    awslocal sqs receive-message \
    --queue-url "$queue_url" \
    --message-attribute-names All \
    --attribute-names All \
    --max-number-of-messages 10 \
    --wait-time-seconds 10
