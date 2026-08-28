#!/usr/bin/env bash
set -euo pipefail
umask 077

# Verifies deployed Core Case X-Ray continuity without changing AWS resources.
# The script sends a synthetic X-Amzn-Trace-Id through the public ALB, then
# waits until the same trace appears in CloudWatch Logs and AWS X-Ray.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
VERIFY_TIMEOUT_SECONDS="${VERIFY_TIMEOUT_SECONDS:-240}"
VERIFY_POLL_SECONDS="${VERIFY_POLL_SECONDS:-10}"
ALLOW_PLAIN_HTTP_SMOKE="${ALLOW_PLAIN_HTTP_SMOKE:-false}"

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

for tool in aws terraform node curl; do
    require_tool "$tool"
done

if [[ ! -d "$TERRAFORM_DIR" ]]; then
    echo "Run this script from the repository root, or set TERRAFORM_DIR." >&2
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

    TF_OUTPUTS_JSON="$TF_OUTPUTS_JSON" KEY="$key" node --input-type=module -e '
const outputs = JSON.parse(process.env.TF_OUTPUTS_JSON ?? "{}");
const key = process.env.KEY;
if (key === undefined || !(key in outputs)) {
  throw new Error(`Terraform output ${key} is missing.`);
}
const value = outputs[key].value;
process.stdout.write(Array.isArray(value) ? value.join(",") : String(value));
'
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

certificate_domain_name() {
    local listener_arn="$1"
    local certificate_arn

    certificate_arn="$(aws_cli elbv2 describe-listeners \
        --listener-arns "$listener_arn" \
        --query 'Listeners[0].Certificates[0].CertificateArn' \
        --output text)"

    if [[ -z "$certificate_arn" || "$certificate_arn" == "None" ]]; then
        return 1
    fi

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
    if [[ -n "$https_listener_arn" && "$https_listener_arn" != "None" ]]; then
        domain_name="$(certificate_domain_name "$https_listener_arn")"
        if [[ "$domain_name" == \** ]]; then
            echo "The public ALB uses a wildcard certificate ($domain_name). Set PUBLIC_ALB_SMOKE_BASE_URL to a concrete certificate-covered hostname." >&2
            exit 1
        fi
        echo "https://$domain_name"
        return 0
    fi

    if [[ "$ALLOW_PLAIN_HTTP_SMOKE" != "true" ]]; then
        echo "The public ALB has no HTTPS listener. Set ALLOW_PLAIN_HTTP_SMOKE=true to verify over plain HTTP." >&2
        exit 1
    fi

    echo "http://$public_alb_dns_name"
}

generate_trace_values() {
    node --input-type=module -e '
import { randomBytes } from "node:crypto";

const epochHex = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0").slice(-8);
const suffix = randomBytes(12).toString("hex");
const parent = randomBytes(8).toString("hex");
const xrayTraceId = `1-${epochHex}-${suffix}`;
const otelTraceId = `${epochHex}${suffix}`;
console.log(`XRAY_TRACE_ID=${xrayTraceId}`);
console.log(`OTEL_TRACE_ID=${otelTraceId}`);
console.log(`XRAY_PARENT_ID=${parent}`);
'
}

extract_assignment() {
    local output="$1"
    local name="$2"

    grep "^$name=" <<<"$output" | tail -1 | sed "s/^$name=//"
}

wait_for_cloudwatch_trace_log() {
    local log_group_name="$1"
    local trace_id="$2"
    local start_millis="$3"
    local deadline=$((SECONDS + VERIFY_TIMEOUT_SECONDS))
    local matched_event

    while (( SECONDS < deadline )); do
        matched_event="$(aws_cli logs filter-log-events \
            --log-group-name "$log_group_name" \
            --start-time "$start_millis" \
            --filter-pattern "\"$trace_id\"" \
            --max-items 1 \
            --query 'events[0].eventId' \
            --output text 2>/dev/null || true)"

        if [[ -n "$matched_event" && "$matched_event" != "None" ]]; then
            return 0
        fi

        sleep "$VERIFY_POLL_SECONDS"
    done

    echo "Timed out waiting for traceId $trace_id in CloudWatch log group $log_group_name." >&2
    return 1
}

wait_for_xray_trace() {
    local xray_trace_id="$1"
    local deadline=$((SECONDS + VERIFY_TIMEOUT_SECONDS))
    local matched_trace

    while (( SECONDS < deadline )); do
        matched_trace="$(aws_cli xray batch-get-traces \
            --trace-ids "$xray_trace_id" \
            --query 'Traces[0].Id' \
            --output text 2>/dev/null || true)"

        if [[ "$matched_trace" == "$xray_trace_id" ]]; then
            return 0
        fi

        sleep "$VERIFY_POLL_SECONDS"
    done

    echo "Timed out waiting for trace $xray_trace_id in AWS X-Ray." >&2
    return 1
}

echo "Reading Terraform outputs from $TERRAFORM_DIR..."
TF_OUTPUTS_JSON="$(terraform_outputs_json)"

public_alb_name="$(tf_output public_alb_name)"
public_alb_dns_name="$(tf_output public_alb_dns_name)"
core_case_service_name="$(tf_output core_case_service_name)"
name_prefix="${NAME_PREFIX:-${core_case_service_name%-core-case-service}}"
core_case_log_group_name="${CORE_CASE_LOG_GROUP_NAME:-/ecs/${name_prefix}/core-case-service}"
public_alb_base_url="$(resolve_public_alb_base_url "$public_alb_name" "$public_alb_dns_name")"

if [[ "$public_alb_base_url" == http://* && "$ALLOW_PLAIN_HTTP_SMOKE" != "true" ]]; then
    echo "Refusing to verify over plain HTTP without ALLOW_PLAIN_HTTP_SMOKE=true." >&2
    exit 1
fi

trace_values="$(generate_trace_values)"
xray_trace_id="$(extract_assignment "$trace_values" XRAY_TRACE_ID)"
otel_trace_id="$(extract_assignment "$trace_values" OTEL_TRACE_ID)"
xray_parent_id="$(extract_assignment "$trace_values" XRAY_PARENT_ID)"
xray_header="Root=$xray_trace_id;Parent=$xray_parent_id;Sampled=1"
start_millis="$(node --input-type=module -e 'console.log(Date.now() - 30000)')"

echo "Sending traced health request to $public_alb_base_url/health..."
http_status="$(curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out "%{http_code}" \
    --header "X-Amzn-Trace-Id: $xray_header" \
    "$public_alb_base_url/health")"

if [[ "$http_status" != "200" ]]; then
    echo "Expected /health to return HTTP 200, got $http_status." >&2
    exit 1
fi

echo "Waiting for CloudWatch Logs traceId $otel_trace_id..."
wait_for_cloudwatch_trace_log "$core_case_log_group_name" "$otel_trace_id" "$start_millis"

echo "Waiting for AWS X-Ray trace $xray_trace_id..."
wait_for_xray_trace "$xray_trace_id"

echo "X-Ray deployed trace verification passed."
echo "Trace ID: $xray_trace_id"
echo "CloudWatch log group: $core_case_log_group_name"
