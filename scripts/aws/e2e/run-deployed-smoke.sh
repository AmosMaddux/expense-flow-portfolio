#!/usr/bin/env bash
set -euo pipefail
umask 077

# Runs the full smoke suite against an already-deployed Terraform sandbox.
# This script resolves Terraform outputs, discovers the deployed ALB mode,
# mints synthetic JWTs, and then delegates to run-terraform-e2e-smoke.sh.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
SMOKE_DB_TUNNEL_LOCAL_PORT="${SMOKE_DB_TUNNEL_LOCAL_PORT:-15433}"

RUN_ALB_SMOKE="${RUN_ALB_SMOKE:-true}"
RUN_PAYMENT_SMOKE="${RUN_PAYMENT_SMOKE:-true}"
RUN_EVENT_FLOW_SMOKE="${RUN_EVENT_FLOW_SMOKE:-true}"
RUN_XRAY_SMOKE="${RUN_XRAY_SMOKE:-true}"
ALLOW_PLAIN_HTTP_SMOKE="${ALLOW_PLAIN_HTTP_SMOKE:-false}"
VERIFY_TIMEOUT_SECONDS="${VERIFY_TIMEOUT_SECONDS:-600}"
VERIFY_POLL_SECONDS="${VERIFY_POLL_SECONDS:-5}"

SMOKE_TENANT_ID="${SMOKE_TENANT_ID:-8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb}"
SMOKE_ACTOR_ID="${SMOKE_ACTOR_ID:-9f1b3f5c-1dc8-4f37-8a23-000000000003}"
SMOKE_ACTOR_ROLE="${SMOKE_ACTOR_ROLE:-Finance Admin}"
SMOKE_EXPENSE_REPORT_ID="${SMOKE_EXPENSE_REPORT_ID:-73000000-0000-4000-8000-000000000001}"
SMOKE_DB_TUNNEL_LOG=""
SMOKE_DB_TUNNEL_PID=""

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

require_tool() {
    local tool="$1"

    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is required. Install it before running this script." >&2
        exit 1
    fi
}

for tool in aws terraform jq node curl; do
    require_tool "$tool"
done

if [[ "$RUN_EVENT_FLOW_SMOKE" == "true" ]]; then
    for tool in session-manager-plugin nc; do
        require_tool "$tool"
    done
fi

SMOKE_RUN_ID="${SMOKE_RUN_ID:-$(node -e "console.log(require('node:crypto').randomUUID())")}"

if [[ ! -d "$TERRAFORM_DIR" || ! -f "scripts/aws/run-terraform-e2e-smoke.sh" ]]; then
    echo "Run this script from the repository root." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

terraform_outputs_json() {
    terraform -chdir="$TERRAFORM_DIR" output -json
}

tf_output() {
    local key="$1"
    local value

    value="$(TF_OUTPUTS_JSON="$TF_OUTPUTS_JSON" KEY="$key" node --input-type=module -e '
const outputs = JSON.parse(process.env.TF_OUTPUTS_JSON ?? "{}");
const key = process.env.KEY;
if (key === undefined || !(key in outputs)) {
  process.exit(1);
}
const value = outputs[key].value;
process.stdout.write(Array.isArray(value) ? value.join(",") : String(value));
')" || {
        echo "Terraform output $key is missing. Apply $TERRAFORM_DIR first." >&2
        exit 1
    }

    if [[ -z "$value" || "$value" == "None" ]]; then
        echo "Terraform output $key is empty. Apply $TERRAFORM_DIR first." >&2
        exit 1
    fi

    echo "$value"
}

load_balancer_arn() {
    aws_cli elbv2 describe-load-balancers \
        --names "$1" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text
}

listener_arn_for_port() {
    local alb_arn="$1"
    local port="$2"

    aws_cli elbv2 describe-listeners \
        --load-balancer-arn "$alb_arn" \
        --query "Listeners[?Port==\`$port\`].ListenerArn | [0]" \
        --output text
}

listener_exists() {
    local listener_arn="$1"

    [[ -n "$listener_arn" && "$listener_arn" != "None" ]]
}

container_env_value() {
    local container_json="$1"
    local name="$2"

    jq -r --arg name "$name" '.environment[]? | select(.name == $name) | .value' <<<"$container_json" | tail -1
}

container_secret_value_from() {
    local container_json="$1"
    local name="$2"

    jq -r --arg name "$name" '.secrets[]? | select(.name == $name) | .valueFrom' <<<"$container_json" | tail -1
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" || "$variable_value" == "None" || "$variable_value" == "null" ]]; then
        echo "$variable_name could not be resolved automatically." >&2
        return 1
    fi
}

current_service_task_definition_arn() {
    local cluster_name="$1"
    local service_name="$2"

    aws_cli ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --query 'services[0].taskDefinition' \
        --output text
}

task_container_json() {
    local task_definition_arn="$1"
    local container_name="$2"

    aws_cli ecs describe-task-definition \
        --task-definition "$task_definition_arn" \
        --query "taskDefinition.containerDefinitions[?name=='$container_name'] | [0]" \
        --output json
}

certificate_domain_name() {
    local https_listener_arn="$1"
    local certificate_arn

    certificate_arn="$(aws_cli elbv2 describe-listeners \
        --listener-arns "$https_listener_arn" \
        --query 'Listeners[0].Certificates[0].CertificateArn' \
        --output text)"
    require_non_empty HTTPS_CERTIFICATE_ARN "$certificate_arn"

    aws_cli acm describe-certificate \
        --certificate-arn "$certificate_arn" \
        --query 'Certificate.DomainName' \
        --output text
}

resolve_public_alb_base_url() {
    local public_alb_name="$1"
    local public_alb_dns_name="$2"
    local alb_arn https_listener_arn domain_name

    if [[ -n "${PUBLIC_ALB_SMOKE_BASE_URL:-}" ]]; then
        echo "${PUBLIC_ALB_SMOKE_BASE_URL%/}"
        return 0
    fi

    alb_arn="$(load_balancer_arn "$public_alb_name")"
    https_listener_arn="$(listener_arn_for_port "$alb_arn" 443)"
    if listener_exists "$https_listener_arn"; then
        domain_name="$(certificate_domain_name "$https_listener_arn")"
        if [[ "$domain_name" == \** ]]; then
            echo "The public ALB uses a wildcard certificate ($domain_name). Set PUBLIC_ALB_SMOKE_BASE_URL to a concrete certificate-covered hostname." >&2
            exit 1
        fi
        echo "https://$domain_name"
        return 0
    fi

    echo "http://$public_alb_dns_name"
}

extract_assignment() {
    local output="$1"
    local name="$2"

    grep "^$name=" <<<"$output" | tail -1 | sed "s/^$name=//"
}

open_database_tunnel() {
    local bastion_instance_id="$1"
    local database_host="$2"

    if nc -z localhost "$SMOKE_DB_TUNNEL_LOCAL_PORT" 2>/dev/null; then
        echo "Local port $SMOKE_DB_TUNNEL_LOCAL_PORT is already in use. Set SMOKE_DB_TUNNEL_LOCAL_PORT to a free port." >&2
        exit 1
    fi

    SMOKE_DB_TUNNEL_LOG="$(mktemp)"
    set -m
    aws_cli ssm start-session \
        --target "$bastion_instance_id" \
        --document-name AWS-StartPortForwardingSessionToRemoteHost \
        --parameters "{\"host\":[\"$database_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$SMOKE_DB_TUNNEL_LOCAL_PORT\"]}" \
        >"$SMOKE_DB_TUNNEL_LOG" 2>&1 &
    SMOKE_DB_TUNNEL_PID=$!
    set +m

    cleanup_database_tunnel() {
        if [[ -n "${SMOKE_DB_TUNNEL_PID:-}" ]]; then
            kill -- "-$SMOKE_DB_TUNNEL_PID" 2>/dev/null || true
            wait "$SMOKE_DB_TUNNEL_PID" 2>/dev/null || true
        fi
        if [[ -n "${SMOKE_DB_TUNNEL_LOG:-}" ]]; then
            rm -f "$SMOKE_DB_TUNNEL_LOG"
        fi
    }
    trap cleanup_database_tunnel EXIT

    local waited=0
    until nc -z localhost "$SMOKE_DB_TUNNEL_LOCAL_PORT" 2>/dev/null; do
        if ! kill -0 "$SMOKE_DB_TUNNEL_PID" 2>/dev/null; then
            echo "Bastion SSM database tunnel exited before it started listening:" >&2
            cat "$SMOKE_DB_TUNNEL_LOG" >&2
            exit 1
        fi
        if (( waited >= 30 )); then
            echo "Timed out waiting for the bastion SSM database tunnel on localhost:$SMOKE_DB_TUNNEL_LOCAL_PORT." >&2
            exit 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
}

local_database_url_from_secret() {
    local database_url_secret_arn="$1"

    aws_cli secretsmanager get-secret-value \
        --secret-id "$database_url_secret_arn" \
        --query SecretString \
        --output text |
        SMOKE_DB_TUNNEL_LOCAL_PORT="$SMOKE_DB_TUNNEL_LOCAL_PORT" node --input-type=module -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const secret = JSON.parse(input);
  const url = new URL(secret.database_url);
  url.hostname = "127.0.0.1";
  url.port = process.env.SMOKE_DB_TUNNEL_LOCAL_PORT;
  url.searchParams.set("uselibpqcompat", "true");
  url.searchParams.set("sslmode", "require");
  process.stdout.write(url.toString());
});
'
}

runtime_smoke_source_cidr() {
    local public_listener_arn="$1"

    aws_cli elbv2 describe-rules \
        --listener-arn "$public_listener_arn" \
        --output json |
        node --input-type=module -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const rules = JSON.parse(input).Rules ?? [];
  for (const priority of new Set(["50", "90"])) {
    const rule = rules.find((candidate) => candidate.Priority === priority);
    const sourceIpCondition = rule?.Conditions?.find((condition) => condition.Field === "source-ip");
    const value = sourceIpCondition?.SourceIpConfig?.Values?.[0];
    if (typeof value === "string" && value.length > 0) {
      process.stdout.write(value);
      return;
    }
  }
});
'
}

echo "Reading Terraform outputs from $TERRAFORM_DIR..."
TF_OUTPUTS_JSON="$(terraform_outputs_json)"

ecs_cluster_name="$(tf_output ecs_cluster_name)"
core_case_service_name="$(tf_output core_case_service_name)"
gl_coding_service_name="$(tf_output gl_coding_service_name)"
public_alb_name="$(tf_output public_alb_name)"
public_alb_dns_name="$(tf_output public_alb_dns_name)"
stage_transition_topic_arn="$(tf_output stage_transition_sns_topic_arn)"
name_prefix="${NAME_PREFIX:-${core_case_service_name%-core-case-service}}"

core_case_task_definition_arn="$(current_service_task_definition_arn "$ecs_cluster_name" "$core_case_service_name")"
gl_coding_task_definition_arn="$(current_service_task_definition_arn "$ecs_cluster_name" "$gl_coding_service_name")"
require_non_empty CORE_CASE_TASK_DEFINITION "$core_case_task_definition_arn"
require_non_empty GL_CODING_TASK_DEFINITION "$gl_coding_task_definition_arn"

core_case_container_json="$(task_container_json "$core_case_task_definition_arn" core-case-service)"
gl_coding_container_json="$(task_container_json "$gl_coding_task_definition_arn" gl-coding-service)"

auth_jwt_issuer="$(container_env_value "$core_case_container_json" AUTH_JWT_ISSUER)"
auth_jwt_key_id="$(container_env_value "$core_case_container_json" AUTH_JWT_KEY_ID)"
runtime_smoke_enabled="$(container_env_value "$core_case_container_json" RUNTIME_SMOKE_GL_CODING_ENABLED)"
auth_private_key_secret_arn="$(container_secret_value_from "$core_case_container_json" AUTH_JWT_PRIVATE_KEY_BASE64)"
runtime_smoke_secret_arn="$(container_secret_value_from "$core_case_container_json" RUNTIME_SMOKE_SHARED_SECRET)"

if [[ "$RUN_ALB_SMOKE" == "true" ]]; then
    if [[ "$runtime_smoke_enabled" != "true" || -z "$runtime_smoke_secret_arn" || "$runtime_smoke_secret_arn" == "None" ]]; then
        echo "Runtime smoke is not enabled in the deployed Core Case task definition." >&2
        echo "Run: AWS_PROFILE=$AWS_PROFILE AUTO_APPROVE=true scripts/aws/e2e/prepare-smoke-prereqs.sh" >&2
        exit 1
    fi
fi

if [[ "$RUN_PAYMENT_SMOKE" == "true" ]]; then
    require_non_empty AUTH_JWT_ISSUER "$auth_jwt_issuer"
    require_non_empty AUTH_JWT_KEY_ID "$auth_jwt_key_id"
    require_non_empty AUTH_JWT_PRIVATE_KEY_SECRET_ARN "$auth_private_key_secret_arn"

    token_exports="$(AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" \
        node scripts/aws/lib/mint-smoke-access-token.mjs \
        --private-key-secret-id "$auth_private_key_secret_arn" \
        --issuer "$auth_jwt_issuer" \
        --key-id "$auth_jwt_key_id" \
        --tenant-id "$SMOKE_TENANT_ID" \
        --user-id "$SMOKE_ACTOR_ID" \
        --role "$SMOKE_ACTOR_ROLE")"
    VALID_ACCESS_TOKEN="$(extract_assignment "$token_exports" VALID_ACCESS_TOKEN)"
    EXPIRED_ACCESS_TOKEN="$(extract_assignment "$token_exports" EXPIRED_ACCESS_TOKEN)"
    require_non_empty VALID_ACCESS_TOKEN "$VALID_ACCESS_TOKEN"
    require_non_empty EXPIRED_ACCESS_TOKEN "$EXPIRED_ACCESS_TOKEN"
    export VALID_ACCESS_TOKEN EXPIRED_ACCESS_TOKEN
fi

PUBLIC_ALB_SMOKE_BASE_URL="$(resolve_public_alb_base_url "$public_alb_name" "$public_alb_dns_name")"
if [[ "$PUBLIC_ALB_SMOKE_BASE_URL" == http://* ]]; then
    ALLOW_PLAIN_HTTP_SMOKE="true"
fi

public_alb_arn="$(load_balancer_arn "$public_alb_name")"
if [[ "$PUBLIC_ALB_SMOKE_BASE_URL" == https://* ]]; then
    public_listener_arn="$(listener_arn_for_port "$public_alb_arn" 443)"
else
    public_listener_arn="$(listener_arn_for_port "$public_alb_arn" 80)"
fi

runtime_smoke_source_cidrs="$(runtime_smoke_source_cidr "$public_listener_arn")"

if [[ "$RUN_ALB_SMOKE" == "true" && ( -z "$runtime_smoke_source_cidrs" || "$runtime_smoke_source_cidrs" == "None" ) ]]; then
    echo "Runtime-smoke source CIDR allowlist is not configured on the public ALB listener." >&2
    echo "Run: AWS_PROFILE=$AWS_PROFILE AUTO_APPROVE=true scripts/aws/e2e/prepare-smoke-prereqs.sh" >&2
    exit 1
fi

if [[ "$RUN_EVENT_FLOW_SMOKE" == "true" ]]; then
    bastion_instance_id="$(tf_output bastion_instance_id)"
    core_case_db_endpoint="$(tf_output core_case_db_endpoint)"
    core_case_db_host="${core_case_db_endpoint%%:*}"
    database_url_secret_arn="$(tf_output stage_transition_consumer_database_url_secret_arn)"
    open_database_tunnel "$bastion_instance_id" "$core_case_db_host"
    VERIFY_DATABASE_URL="$(local_database_url_from_secret "$database_url_secret_arn")"
    export VERIFY_DATABASE_URL
fi

export AWS_PROFILE AWS_REGION ALLOW_NON_SMOKE_PROFILE
export RUN_ALB_SMOKE RUN_PAYMENT_SMOKE RUN_EVENT_FLOW_SMOKE
export VERIFY_TIMEOUT_SECONDS VERIFY_POLL_SECONDS
export PUBLIC_ALB_SMOKE_BASE_URL ALLOW_PLAIN_HTTP_SMOKE
export EXPENSE_REPORT_ID="$SMOKE_EXPENSE_REPORT_ID"
export SYNTHETIC_EXPENSE_REPORT_ID="$SMOKE_EXPENSE_REPORT_ID"
export SYNTHETIC_TENANT_ID="$SMOKE_TENANT_ID"
export CORRELATION_ID="$SMOKE_RUN_ID"
export IDEMPOTENCY_KEY="terraform-e2e-smoke-$SMOKE_RUN_ID"
export CORE_CASE_RUNTIME_SMOKE_SECRET_NAME="$runtime_smoke_secret_arn"
export CORE_CASE_TASK_ROLE_NAME="${name_prefix}-core-case-task-role"
export GL_CODING_TASK_ROLE_NAME="${name_prefix}-gl-coding-task-role"
export EXECUTION_ROLE_NAME="${name_prefix}-ecs-task-execution-role"
export CORE_CASE_RUNTIME_POLICY_NAME="${name_prefix}-core-case-runtime"
export STAGE_TRANSITION_SNS_TOPIC_NAME="${stage_transition_topic_arn##*:}"

echo "Resolved public ALB smoke base URL: $PUBLIC_ALB_SMOKE_BASE_URL"
echo "Using synthetic Expense Report: $SMOKE_EXPENSE_REPORT_ID"
echo "Running deployed sandbox smoke..."

scripts/aws/run-terraform-e2e-smoke.sh

if [[ "$RUN_XRAY_SMOKE" == "true" ]]; then
    echo "Running deployed X-Ray trace continuity smoke..."
    PUBLIC_ALB_SMOKE_BASE_URL="$PUBLIC_ALB_SMOKE_BASE_URL" \
        ALLOW_PLAIN_HTTP_SMOKE="$ALLOW_PLAIN_HTTP_SMOKE" \
        VERIFY_TIMEOUT_SECONDS="$VERIFY_TIMEOUT_SECONDS" \
        VERIFY_POLL_SECONDS="$VERIFY_POLL_SECONDS" \
        TERRAFORM_DIR="$TERRAFORM_DIR" \
        AWS_PROFILE="$AWS_PROFILE" \
        AWS_REGION="$AWS_REGION" \
        ALLOW_NON_SMOKE_PROFILE="$ALLOW_NON_SMOKE_PROFILE" \
        scripts/aws/e2e/verify-xray-trace.sh
else
    echo "Skipping X-Ray trace continuity smoke (RUN_XRAY_SMOKE=$RUN_XRAY_SMOKE)."
fi
