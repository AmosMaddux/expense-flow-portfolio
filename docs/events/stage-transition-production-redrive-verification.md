# Stage Transition Production Redrive Verification

Tracking item: `SCRUM-133`.

The deployed queue referenced by `STAGE_TRANSITION_SQS_QUEUE_URL` must have a
stage-transition DLQ and an SQS `RedrivePolicy` before the plain SQS projection
consumer is enabled outside local development.

The platform-owned deployment change for `SCRUM-133` must create or reference:

- Source queue: `STAGE_TRANSITION_SQS_QUEUE_URL`
- Dead-letter queue: stage-transition event DLQ
- Source queue `RedrivePolicy.deadLetterTargetArn`: the stage-transition DLQ ARN
- Source queue `RedrivePolicy.maxReceiveCount`: `3`

Reviewers verify the deployed queue without exposing controlled data by checking
only queue attributes:

```sh
aws sqs get-queue-attributes \
    --queue-url "$STAGE_TRANSITION_SQS_QUEUE_URL" \
    --attribute-names RedrivePolicy
```

The deployment is not accepted until the returned `RedrivePolicy` contains the
stage-transition DLQ ARN and `maxReceiveCount` is `3`.
