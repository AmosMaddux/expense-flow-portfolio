# Shared helpers for publishing a synthetic stage-transition CloudEvent and
# verifying it lands in the stage_transition_projection table and drives
# Lambda invocations. Sourced by scripts/aws/SCRUM-149/verify-stage-transition-lambda.sh
# and scripts/aws/run-terraform-e2e-smoke.sh so both stay on one copy of the
# CloudEvent shape, the projection SQL, and the polling scaffolding.
#
# Callers must set: VERIFY_DATABASE_URL, SYNTHETIC_EVENT_ID,
# SYNTHETIC_CORRELATION_ID, SYNTHETIC_EXPENSE_REPORT_ID, SYNTHETIC_TENANT_ID,
# VERIFY_TIMEOUT_SECONDS, VERIFY_POLL_SECONDS, and must define aws_cli().

query_projection_count() {
    VERIFY_DATABASE_URL="$VERIFY_DATABASE_URL" \
        SYNTHETIC_EVENT_ID="$SYNTHETIC_EVENT_ID" \
        node --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.VERIFY_DATABASE_URL });
try {
  const result = await pool.query(
    "select count(*)::int as count from stage_transition_projection where event_id = $1",
    [process.env.SYNTHETIC_EVENT_ID],
  );
  process.stdout.write(String(result.rows[0]?.count ?? 0));
} finally {
  await pool.end();
}
'
}

require_projection_count() {
    local expected_count="$1"
    local actual_count

    actual_count="$(query_projection_count)"
    if [[ "$actual_count" != "$expected_count" ]]; then
        echo "Expected projection count $expected_count for synthetic event $SYNTHETIC_EVENT_ID, got $actual_count. Set SYNTHETIC_EVENT_ID to a fresh value." >&2
        exit 1
    fi
}

poll_projection_count() {
    local expected_count="$1"
    local deadline actual_count

    deadline=$(($(date +%s) + VERIFY_TIMEOUT_SECONDS))
    while (($(date +%s) <= deadline)); do
        if actual_count="$(query_projection_count)"; then
            if [[ "$actual_count" == "$expected_count" ]]; then
                return 0
            fi
        else
            echo "Transient error querying projection count; retrying..." >&2
        fi
        sleep "$VERIFY_POLL_SECONDS"
    done

    echo "Timed out waiting for projection count $expected_count for synthetic event $SYNTHETIC_EVENT_ID." >&2
    exit 1
}

publish_synthetic_event() {
    local stage_transition_topic_arn="$1"
    local message_file

    message_file="$(mktemp)"
    SYNTHETIC_EVENT_ID="$SYNTHETIC_EVENT_ID" \
        SYNTHETIC_CORRELATION_ID="$SYNTHETIC_CORRELATION_ID" \
        SYNTHETIC_EXPENSE_REPORT_ID="$SYNTHETIC_EXPENSE_REPORT_ID" \
        SYNTHETIC_TENANT_ID="$SYNTHETIC_TENANT_ID" \
        node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({
  specversion: '1.0',
  type: 'com.expenseflow.expense-report.stage-transitioned.v1',
  source: 'urn:expenseflow:core-case-service',
  id: process.env.SYNTHETIC_EVENT_ID,
  time: new Date().toISOString(),
  subject: 'expense-reports/' + process.env.SYNTHETIC_EXPENSE_REPORT_ID,
  datacontenttype: 'application/json',
  dataschema: 'urn:expenseflow:schema:events:expense-report-stage-transitioned:v1',
  correlationid: process.env.SYNTHETIC_CORRELATION_ID,
  data: {
    caseId: process.env.SYNTHETIC_EXPENSE_REPORT_ID,
    tenantId: process.env.SYNTHETIC_TENANT_ID,
    fromStage: 'Submitted',
    toStage: 'Manager Approval',
    correlationId: process.env.SYNTHETIC_CORRELATION_ID
  }
}));
" "$message_file"

    aws_cli sns publish \
        --topic-arn "$stage_transition_topic_arn" \
        --message "file://$message_file" \
        --message-attributes "{\"eventType\":{\"DataType\":\"String\",\"StringValue\":\"com.expenseflow.expense-report.stage-transitioned.v1\"},\"correlationId\":{\"DataType\":\"String\",\"StringValue\":\"$SYNTHETIC_CORRELATION_ID\"}}" >/dev/null
    rm -f "$message_file"
}

require_synthetic_report_exists() {
    VERIFY_DATABASE_URL="$VERIFY_DATABASE_URL" \
        SYNTHETIC_EXPENSE_REPORT_ID="$SYNTHETIC_EXPENSE_REPORT_ID" \
        SYNTHETIC_TENANT_ID="$SYNTHETIC_TENANT_ID" \
        node --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.VERIFY_DATABASE_URL });
try {
  const result = await pool.query(
    "select id from expense_report where id = $1 and tenant_id = $2",
    [process.env.SYNTHETIC_EXPENSE_REPORT_ID, process.env.SYNTHETIC_TENANT_ID],
  );
  if (result.rowCount !== 1) {
    throw new Error("Synthetic Expense Report prerequisite is missing. Seed expense_report with SYNTHETIC_EXPENSE_REPORT_ID/SYNTHETIC_TENANT_ID before running the event-flow verification.");
  }
} finally {
  await pool.end();
}
'
}

lambda_invocation_sum_since() {
    local function_name="$1"
    local start_time="$2"
    local end_time

    end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    aws_cli cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Invocations \
        --dimensions Name=FunctionName,Value="$function_name" \
        --start-time "$start_time" \
        --end-time "$end_time" \
        --period 60 \
        --statistics Sum \
        --query 'sum(Datapoints[].Sum)' \
        --output text
}

poll_lambda_invocations() {
    local function_name="$1"
    local start_time="$2"
    local minimum_invocations="$3"
    local deadline invocation_sum

    deadline=$(($(date +%s) + VERIFY_TIMEOUT_SECONDS))
    while (($(date +%s) <= deadline)); do
        if invocation_sum="$(lambda_invocation_sum_since "$function_name" "$start_time")"; then
            if INVOCATION_SUM="$invocation_sum" MINIMUM_INVOCATIONS="$minimum_invocations" node --input-type=module -e '
const invocationSum = Number(process.env.INVOCATION_SUM);
const minimumInvocations = Number(process.env.MINIMUM_INVOCATIONS);
process.exit(Number.isFinite(invocationSum) && invocationSum >= minimumInvocations ? 0 : 1);
'; then
                return 0
            fi
        else
            echo "Transient error querying Lambda invocation metrics; retrying..." >&2
        fi
        sleep "$VERIFY_POLL_SECONDS"
    done

    echo "Timed out waiting for $function_name invocation metrics to reach $minimum_invocations." >&2
    exit 1
}
