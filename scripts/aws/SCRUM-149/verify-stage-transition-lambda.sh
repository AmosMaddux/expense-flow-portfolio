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
VERIFY_CONSUMER_BEHAVIOR="${VERIFY_CONSUMER_BEHAVIOR:-false}"
VERIFY_DATABASE_URL="${VERIFY_DATABASE_URL:-${DATABASE_URL:-}}"
VERIFY_TIMEOUT_SECONDS="${VERIFY_TIMEOUT_SECONDS:-180}"
VERIFY_POLL_SECONDS="${VERIFY_POLL_SECONDS:-5}"
SYNTHETIC_EVENT_ID="${SYNTHETIC_EVENT_ID:-$(node -e "console.log(crypto.randomUUID())")}"
SYNTHETIC_CORRELATION_ID="${SYNTHETIC_CORRELATION_ID:-$(node -e "console.log(crypto.randomUUID())")}"
SYNTHETIC_EXPENSE_REPORT_ID="${SYNTHETIC_EXPENSE_REPORT_ID:-30000000-0000-4000-8000-000000000149}"
SYNTHETIC_TENANT_ID="${SYNTHETIC_TENANT_ID:-10000000-0000-4000-8000-000000000149}"
SYNTHETIC_INVALID_MESSAGE_ID="${SYNTHETIC_INVALID_MESSAGE_ID:-$(node -e "console.log(crypto.randomUUID())")}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib/stage-transition-verify.sh
source "$SCRIPT_DIR/lib/stage-transition-verify.sh"

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

redrive_max_receive_count() {
    local source_queue_url="$1"
    local redrive_policy

    redrive_policy="$(queue_attribute "$source_queue_url" RedrivePolicy)"
    REDRIVE_POLICY="$redrive_policy" node --input-type=module -e '
const policy = JSON.parse(process.env.REDRIVE_POLICY || "{}");
process.stdout.write(String(Number(policy.maxReceiveCount || 0)));
'
}

require_lambda_database_environment_safe() {
    local environment_json="$1"

    ENVIRONMENT_JSON="$environment_json" node --input-type=module -e '
const variables = JSON.parse(process.env.ENVIRONMENT_JSON || "{}");
if (!("DATABASE_SECRET_ARN" in variables)) {
  throw new Error("Stage-transition Lambda must receive DATABASE_SECRET_ARN for secure runtime secret resolution.");
}
if ("DATABASE_URL" in variables) {
  throw new Error("Stage-transition Lambda must not expose DATABASE_URL in environment configuration.");
}
if ("DATABASE_URL_SECRET_ID" in variables) {
  throw new Error("Stage-transition Lambda must not receive DATABASE_URL_SECRET_ID.");
}
'
}

require_role_has_scoped_database_secret_read() {
    local role_name="$1"
    local database_secret_arn="$2"
    local policy_names policy_document policy_documents_json

    if [[ -z "$database_secret_arn" ]]; then
        echo "DATABASE_SECRET_ARN must be provided to verify role permissions." >&2
        return 1
    fi

    policy_names="$(aws_cli iam list-role-policies \
        --role-name "$role_name" \
        --query 'PolicyNames[]' \
        --output text)"

    policy_documents_json="[]"
    for policy_name in $policy_names; do
        policy_document="$(aws_cli iam get-role-policy \
            --role-name "$role_name" \
            --policy-name "$policy_name" \
            --query PolicyDocument \
            --output json)"
        policy_documents_json="$(
            POLICY_DOCUMENTS_JSON="$policy_documents_json" POLICY_DOCUMENT="$policy_document" node --input-type=module -e '
const documents = JSON.parse(process.env.POLICY_DOCUMENTS_JSON || "[]");
documents.push(JSON.parse(process.env.POLICY_DOCUMENT || "{}"));
process.stdout.write(JSON.stringify(documents));
'
        )"
    done

    POLICY_DOCUMENTS_JSON="$policy_documents_json" DATABASE_SECRET_ARN="$database_secret_arn" node --input-type=module -e '
const documents = JSON.parse(process.env.POLICY_DOCUMENTS_JSON || "[]");
const secretArn = process.env.DATABASE_SECRET_ARN;
let found = false;
for (const doc of documents) {
  if (doc.Statement) {
    for (const statement of doc.Statement) {
      if (statement.Effect === "Allow" && statement.Action?.includes("secretsmanager:GetSecretValue")) {
        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
        if (resources.includes(secretArn)) {
          found = true;
          break;
        }
      }
    }
  }
  if (found) break;
}
if (!found) {
  throw new Error("Stage-transition Lambda role must grant secretsmanager:GetSecretValue for the database secret ARN.");
}
'
}

require_database_url() {
    if [[ -z "$VERIFY_DATABASE_URL" ]]; then
        echo "VERIFY_DATABASE_URL or DATABASE_URL must be supplied through asm-exec before verifying consumer behavior." >&2
        exit 1
    fi
}

poll_lambda_failure_logs() {
    local start_epoch_ms="$1"
    local deadline logs_json

    deadline=$(( $(date +%s) + VERIFY_TIMEOUT_SECONDS ))
    while (( $(date +%s) <= deadline )); do
        logs_json="$(aws_cli logs filter-log-events \
            --log-group-name "/aws/lambda/$FUNCTION_NAME" \
            --start-time "$start_epoch_ms" \
            --filter-pattern "\"A stage-transition Lambda SQS record failed\"" \
            --query 'events[].message' \
            --output json)"

        if LOGS_JSON="$logs_json" node --input-type=module -e '
const logs = JSON.parse(process.env.LOGS_JSON || "[]");
process.exit(logs.length >= 1 ? 0 : 1);
'; then
            return 0
        fi
        sleep "$VERIFY_POLL_SECONDS"
    done

    echo "Timed out waiting for a sanitized stage-transition Lambda failure log entry." >&2
    exit 1
}

publish_invalid_message() {
    local source_queue_url="$1"
    local body

    body="{\"id\":\"$SYNTHETIC_INVALID_MESSAGE_ID\",\"type\":\"synthetic-invalid-stage-transition\"}"
    aws_cli sqs send-message \
        --queue-url "$source_queue_url" \
        --message-body "$body" >/dev/null
}

receive_dlq_messages() {
    local dead_letter_queue_url="$1"

    aws_cli sqs receive-message \
        --queue-url "$dead_letter_queue_url" \
        --max-number-of-messages 10 \
        --visibility-timeout 0 \
        --wait-time-seconds 2 \
        --query 'Messages[].Body' \
        --output json
}

poll_dlq_for_invalid_message() {
    local dead_letter_queue_url="$1"
    local deadline messages_json

    deadline=$(( $(date +%s) + VERIFY_TIMEOUT_SECONDS ))
    while (( $(date +%s) <= deadline )); do
        messages_json="$(receive_dlq_messages "$dead_letter_queue_url")"
        if DLQ_MESSAGES_JSON="$messages_json" SYNTHETIC_INVALID_MESSAGE_ID="$SYNTHETIC_INVALID_MESSAGE_ID" node --input-type=module -e '
const messages = JSON.parse(process.env.DLQ_MESSAGES_JSON || "[]");
if (messages.some((message) => String(message).includes(process.env.SYNTHETIC_INVALID_MESSAGE_ID))) {
  process.exit(0);
}
process.exit(1);
'; then
            return 0
        fi
        sleep "$VERIFY_POLL_SECONDS"
    done

    echo "Timed out waiting for failed synthetic message to reach the DLQ." >&2
    exit 1
}

verify_consumer_behavior() {
    local stage_transition_topic_arn="$1"
    local source_queue_url="$2"
    local dead_letter_queue_url="$3"
    local max_receive_count start_time start_epoch_ms

    require_database_url
    require_synthetic_report_exists
    require_projection_count 0

    start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    start_epoch_ms="$(date +%s%3N)"

    publish_synthetic_event "$stage_transition_topic_arn"
    poll_projection_count 1
    poll_lambda_invocations "$FUNCTION_NAME" "$start_time" 1

    publish_synthetic_event "$stage_transition_topic_arn"
    poll_lambda_invocations "$FUNCTION_NAME" "$start_time" 2
    require_projection_count 1

    max_receive_count="$(redrive_max_receive_count "$source_queue_url")"
    publish_invalid_message "$source_queue_url"
    poll_dlq_for_invalid_message "$dead_letter_queue_url"
    poll_lambda_invocations "$FUNCTION_NAME" "$start_time" "$((1 + max_receive_count))"
    poll_lambda_failure_logs "$start_epoch_ms"

    echo "Verified SCRUM-149 consumer projection, idempotency, invocation metrics, failure logs, and DLQ redrive."
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

    environment_json="$(aws_cli lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --query 'Environment.Variables' \
        --output json)"
    require_lambda_database_environment_safe "$environment_json"

    database_secret_arn="$(ENVIRONMENT_JSON="$environment_json" node --input-type=module -e '
const variables = JSON.parse(process.env.ENVIRONMENT_JSON || "{}");
process.stdout.write(variables.DATABASE_SECRET_ARN || "");
')"

    role_arn="$(aws_cli lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --query Role \
        --output text)"
    require_role_has_scoped_database_secret_read "${role_arn##*/}" "$database_secret_arn"

    source_queue_url="$(queue_url "$STAGE_TRANSITION_QUEUE_NAME")"
    dead_letter_queue_url="$(queue_url "$STAGE_TRANSITION_DLQ_NAME")"
    source_queue_arn="$(queue_attribute "$source_queue_url" QueueArn)"
    dead_letter_queue_arn="$(queue_attribute "$dead_letter_queue_url" QueueArn)"
    stage_transition_topic_arn="$(topic_arn)"

    if [[ -z "$stage_transition_topic_arn" || "$stage_transition_topic_arn" == "None" ]]; then
        echo "Missing SNS topic: $STAGE_TRANSITION_SNS_TOPIC_NAME" >&2
        exit 1
    fi

    require_mapping_enabled "$source_queue_arn"
    require_redrive_to_dlq "$source_queue_url" "$dead_letter_queue_arn"

    if [[ "$VERIFY_CONSUMER_BEHAVIOR" == "true" ]]; then
        verify_consumer_behavior "$stage_transition_topic_arn" "$source_queue_url" "$dead_letter_queue_url"
    fi

    echo "SCRUM-149 Lambda verification passed."
    echo "Function: $FUNCTION_NAME ($function_state)"
    echo "Queue: $STAGE_TRANSITION_QUEUE_NAME"
    echo "DLQ: $STAGE_TRANSITION_DLQ_NAME"
    echo "Topic: $STAGE_TRANSITION_SNS_TOPIC_NAME"
}

main "$@"
