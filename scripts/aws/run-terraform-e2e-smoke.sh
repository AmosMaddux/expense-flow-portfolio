#!/usr/bin/env bash
set -euo pipefail

# End-to-end smoke test for the Terraform-managed sandbox environment.
#
# Unlike the other scripts under scripts/aws/, which discover pre-Terraform
# bash-provisioned resources by hardcoded name, this script reads every
# identifier it can from `terraform output -json` against
# infra/terraform/environments/sandbox, so it stays correct as the Terraform
# modules evolve. It then:
#
#   1. Runs the existing ALB smoke (scripts/aws/run-task-smoke.sh) against the
#      Terraform-managed public ALB, ECS services, and target groups.
#   2. Runs the existing API Gateway payment-path smoke
#      (scripts/aws/SCRUM-150/smoke-issue-payment-http-api.sh) against the
#      Terraform-managed HTTP API, JWT authorizer, and Issue Payment Lambda.
#   3. Publishes a synthetic stage-transition event to the Terraform-managed
#      SNS topic and polls the Postgres stage_transition_projection table and
#      Lambda invocation metrics to prove the SQS event flow runs end to end.
#
# This script does not create infrastructure. Run `terraform apply` in
# infra/terraform/environments/sandbox first.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"

RUN_ALB_SMOKE="${RUN_ALB_SMOKE:-true}"
RUN_PAYMENT_SMOKE="${RUN_PAYMENT_SMOKE:-true}"
RUN_EVENT_FLOW_SMOKE="${RUN_EVENT_FLOW_SMOKE:-true}"

PUBLIC_ALB_SMOKE_BASE_URL="${PUBLIC_ALB_SMOKE_BASE_URL:-}"

VALID_ACCESS_TOKEN="${VALID_ACCESS_TOKEN:-}"
EXPIRED_ACCESS_TOKEN="${EXPIRED_ACCESS_TOKEN:-}"
EXPENSE_REPORT_ID="${EXPENSE_REPORT_ID:-}"

VERIFY_DATABASE_URL="${VERIFY_DATABASE_URL:-}"
SYNTHETIC_EXPENSE_REPORT_ID="${SYNTHETIC_EXPENSE_REPORT_ID:-30000000-0000-4000-8000-000000000156}"
SYNTHETIC_TENANT_ID="${SYNTHETIC_TENANT_ID:-10000000-0000-4000-8000-000000000156}"
SYNTHETIC_EVENT_ID="${SYNTHETIC_EVENT_ID:-$(node -e "console.log(crypto.randomUUID())")}"
SYNTHETIC_CORRELATION_ID="${SYNTHETIC_CORRELATION_ID:-$(node -e "console.log(crypto.randomUUID())")}"
VERIFY_TIMEOUT_SECONDS="${VERIFY_TIMEOUT_SECONDS:-180}"
VERIFY_POLL_SECONDS="${VERIFY_POLL_SECONDS:-5}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

terraform_outputs_json() {
    terraform -chdir="$TERRAFORM_DIR" output -json
}

output_value() {
    local key="$1"

    TF_OUTPUTS_JSON="$TF_OUTPUTS_JSON" KEY="$key" node --input-type=module -e '
const outputs = JSON.parse(process.env.TF_OUTPUTS_JSON);
const key = process.env.KEY;
if (!(key in outputs)) {
  throw new Error(`Terraform output "${key}" is not set. Apply infra/terraform/environments/sandbox first.`);
}
process.stdout.write(String(outputs[key].value));
'
}

secret_string() {
    aws_cli secretsmanager get-secret-value \
        --secret-id "$1" \
        --query SecretString \
        --output text
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied explicitly." >&2
        return 1
    fi
}

echo "Reading Terraform outputs from $TERRAFORM_DIR..."
TF_OUTPUTS_JSON="$(terraform_outputs_json)"

run_alb_smoke() {
    local vpc_id public_subnet_ids

    echo "=== ALB smoke: ALB request -> Core Case ==="
    require_non_empty PUBLIC_ALB_SMOKE_BASE_URL "$PUBLIC_ALB_SMOKE_BASE_URL"

    vpc_id="$(output_value vpc_id)"
    public_subnet_ids="$(output_value public_subnet_ids)"

    VPC_ID="$vpc_id" \
        PUBLIC_SUBNETS="$public_subnet_ids" \
        ALB_NAME="$(output_value public_alb_name)" \
        INTERNAL_ALB_NAME="$(output_value internal_alb_name)" \
        CORE_CASE_TARGET_GROUP_NAME="$(output_value core_case_target_group_name)" \
        INTERNAL_GL_CODING_TARGET_GROUP_NAME="$(output_value gl_coding_target_group_name)" \
        CLUSTER_NAME="$(output_value ecs_cluster_name)" \
        CORE_CASE_SERVICE_NAME="$(output_value core_case_service_name)" \
        GL_CODING_SERVICE_NAME="$(output_value gl_coding_service_name)" \
        RECEIPT_STORAGE_BUCKET="$(output_value receipt_storage_bucket_name)" \
        DYNAMODB_EXPENSE_REPORT_TABLE="$(output_value dynamodb_expense_report_table_name)" \
        PUBLIC_ALB_SMOKE_BASE_URL="$PUBLIC_ALB_SMOKE_BASE_URL" \
        AWS_PROFILE="$AWS_PROFILE" \
        AWS_REGION="$AWS_REGION" \
        ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
        scripts/aws/run-task-smoke.sh
}

run_payment_smoke() {
    local issue_payment_url_prefix issue_payment_url

    echo "=== API Gateway payment smoke: API Gateway -> Lambda -> Core Case internal route ==="
    require_non_empty VALID_ACCESS_TOKEN "$VALID_ACCESS_TOKEN"
    require_non_empty EXPIRED_ACCESS_TOKEN "$EXPIRED_ACCESS_TOKEN"
    require_non_empty EXPENSE_REPORT_ID "$EXPENSE_REPORT_ID"

    issue_payment_url_prefix="$(output_value http_api_issue_payment_url_prefix)"
    issue_payment_url="${issue_payment_url_prefix}${EXPENSE_REPORT_ID}/settlement"

    ISSUE_PAYMENT_URL="$issue_payment_url" \
        VALID_ACCESS_TOKEN="$VALID_ACCESS_TOKEN" \
        EXPIRED_ACCESS_TOKEN="$EXPIRED_ACCESS_TOKEN" \
        EXPENSE_REPORT_ID="$EXPENSE_REPORT_ID" \
        scripts/aws/SCRUM-150/smoke-issue-payment-http-api.sh
}

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
    throw new Error("Synthetic Expense Report prerequisite is missing. Seed expense_report with SYNTHETIC_EXPENSE_REPORT_ID/SYNTHETIC_TENANT_ID before running the event-flow smoke.");
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

run_event_flow_smoke() {
    local stage_transition_topic_arn database_url_secret_arn function_name start_time

    echo "=== Event flow smoke: SNS -> SQS -> Lambda -> Postgres ==="

    stage_transition_topic_arn="$(output_value stage_transition_sns_topic_arn)"
    function_name="$(output_value stage_transition_consumer_lambda_function_name)"

    if [[ -z "$VERIFY_DATABASE_URL" ]]; then
        database_url_secret_arn="$(output_value stage_transition_consumer_database_url_secret_arn)"
        VERIFY_DATABASE_URL="$(secret_string "$database_url_secret_arn" | node --input-type=module -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.parse(input).database_url);
});
')"
    fi

    require_synthetic_report_exists
    require_projection_count 0

    start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    publish_synthetic_event "$stage_transition_topic_arn"
    poll_projection_count 1
    poll_lambda_invocations "$function_name" "$start_time" 1

    echo "Event flow smoke passed: synthetic event $SYNTHETIC_EVENT_ID projected and Lambda $function_name invoked."
}

if [[ "$RUN_ALB_SMOKE" == "true" ]]; then
    run_alb_smoke
else
    echo "Skipping ALB smoke (RUN_ALB_SMOKE=$RUN_ALB_SMOKE)."
fi

if [[ "$RUN_PAYMENT_SMOKE" == "true" ]]; then
    run_payment_smoke
else
    echo "Skipping API Gateway payment smoke (RUN_PAYMENT_SMOKE=$RUN_PAYMENT_SMOKE)."
fi

if [[ "$RUN_EVENT_FLOW_SMOKE" == "true" ]]; then
    run_event_flow_smoke
else
    echo "Skipping event flow smoke (RUN_EVENT_FLOW_SMOKE=$RUN_EVENT_FLOW_SMOKE)."
fi

echo "Terraform sandbox end-to-end smoke passed."
