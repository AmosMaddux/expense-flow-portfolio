#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

CLUSTER_NAME="${CLUSTER_NAME:-expenseflow-sandbox}"
ALB_NAME="${ALB_NAME:-expenseflow-sandbox-alb}"
CORE_CASE_TARGET_GROUP_NAME="${CORE_CASE_TARGET_GROUP_NAME:-expenseflow-sandbox-core-case-tg}"
GL_CODING_TARGET_GROUP_NAME="${GL_CODING_TARGET_GROUP_NAME:-expenseflow-sandbox-gl-coding-tg}"
CORE_CASE_SERVICE_NAME="${CORE_CASE_SERVICE_NAME:-expenseflow-core-case-service}"
GL_CODING_SERVICE_NAME="${GL_CODING_SERVICE_NAME:-expenseflow-gl-coding-service}"
CORE_CASE_TASK_ROLE_NAME="${CORE_CASE_TASK_ROLE_NAME:-expenseflow-sandbox-core-case-task-role}"
GL_CODING_TASK_ROLE_NAME="${GL_CODING_TASK_ROLE_NAME:-expenseflow-sandbox-gl-coding-task-role}"
RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-sandbox-expense-report}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"
CORE_CASE_RUNTIME_POLICY_NAME="${CORE_CASE_RUNTIME_POLICY_NAME:-expenseflow-sandbox-scrum-147-core-case-runtime}"
SMOKE_PATH="${SMOKE_PATH:-/v1/openapi.json}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

target_group_arn() {
    aws_cli elbv2 describe-target-groups \
        --names "$1" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text
}

load_balancer_arn() {
    aws_cli elbv2 describe-load-balancers \
        --names "$ALB_NAME" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text
}

load_balancer_dns_name() {
    aws_cli elbv2 describe-load-balancers \
        --names "$ALB_NAME" \
        --query 'LoadBalancers[0].DNSName' \
        --output text
}

listener_arn() {
    local alb_arn="$1"

    aws_cli elbv2 describe-listeners \
        --load-balancer-arn "$alb_arn" \
        --query 'Listeners[?Port==`80`].ListenerArn | [0]' \
        --output text
}

topic_arn() {
    local topic_name="$1"

    aws_cli sns list-topics \
        --query "Topics[?ends_with(TopicArn, ':$topic_name')].TopicArn | [0]" \
        --output text
}

assert_service_active() {
    local service_name="$1"
    local service_status

    service_status="$(aws_cli ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --query 'services[0].status' \
        --output text)"

    if [[ "$service_status" != "ACTIVE" ]]; then
        echo "ECS service $service_name is not ACTIVE: $service_status" >&2
        return 1
    fi
}

assert_listener_rule() {
    local listener_arn="$1"
    local priority="$2"
    local target_group_arn="$3"
    local rule_target_group_arn

    rule_target_group_arn="$(aws_cli elbv2 describe-rules \
        --listener-arn "$listener_arn" \
        --query "Rules[?Priority=='$priority'].Actions[0].TargetGroupArn | [0]" \
        --output text)"

    if [[ "$rule_target_group_arn" != "$target_group_arn" ]]; then
        echo "Listener rule priority $priority does not forward to $target_group_arn." >&2
        return 1
    fi
}

wait_for_healthy_targets() {
    local label="$1"
    local target_group_arn="$2"
    local healthy_count

    for _ in $(seq 1 40); do
        healthy_count="$(aws_cli elbv2 describe-target-health \
            --target-group-arn "$target_group_arn" \
            --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" \
            --output text)"

        echo "$label target group healthy target count=$healthy_count"

        if [[ "$healthy_count" =~ ^[0-9]+$ && "$healthy_count" -gt 0 ]]; then
            return 0
        fi

        sleep 10
    done

    echo "$label target group did not report a healthy target before timeout." >&2
    return 1
}

preflight_runtime_configuration() {
    local alb_arn http_listener_arn core_tg_arn gl_tg_arn stage_topic_arn

    echo "Checking ALB, listener, and target groups..."
    alb_arn="$(load_balancer_arn)"
    http_listener_arn="$(listener_arn "$alb_arn")"
    core_tg_arn="$(target_group_arn "$CORE_CASE_TARGET_GROUP_NAME")"
    gl_tg_arn="$(target_group_arn "$GL_CODING_TARGET_GROUP_NAME")"
    assert_listener_rule "$http_listener_arn" 100 "$core_tg_arn"
    assert_listener_rule "$http_listener_arn" 200 "$gl_tg_arn"

    echo "Checking ECS services..."
    assert_service_active "$CORE_CASE_SERVICE_NAME"
    assert_service_active "$GL_CODING_SERVICE_NAME"

    echo "Checking Core Case AWS runtime dependencies..."
    stage_topic_arn="$(topic_arn "$STAGE_TRANSITION_SNS_TOPIC_NAME")"
    if [[ -z "$stage_topic_arn" || "$stage_topic_arn" == "None" ]]; then
        echo "Missing SNS topic: $STAGE_TRANSITION_SNS_TOPIC_NAME" >&2
        return 1
    fi
    aws_cli s3api head-bucket --bucket "$RECEIPT_STORAGE_BUCKET" >/dev/null
    aws_cli dynamodb describe-table --table-name "$DYNAMODB_EXPENSE_REPORT_TABLE" >/dev/null

    echo "Checking ECS task roles and Core Case runtime policy..."
    aws_cli iam get-role --role-name "$CORE_CASE_TASK_ROLE_NAME" >/dev/null
    aws_cli iam get-role --role-name "$GL_CODING_TASK_ROLE_NAME" >/dev/null
    aws_cli iam get-role-policy \
        --role-name "$CORE_CASE_TASK_ROLE_NAME" \
        --policy-name "$CORE_CASE_RUNTIME_POLICY_NAME" >/dev/null

    wait_for_healthy_targets "Core Case" "$core_tg_arn"
    wait_for_healthy_targets "GL-coding" "$gl_tg_arn"
}

run_alb_smoke() {
    local alb_dns_name smoke_url response_file status_code

    alb_dns_name="$(load_balancer_dns_name)"
    smoke_url="http://$alb_dns_name$SMOKE_PATH"
    response_file="$(mktemp)"

    echo "Calling ALB smoke endpoint: $smoke_url"
    status_code="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' "$smoke_url")"

    if [[ "$status_code" != "200" ]]; then
        echo "ALB smoke failed with HTTP $status_code." >&2
        cat "$response_file" >&2
        rm -f "$response_file"
        return 1
    fi

    if ! grep --quiet '"/v1/auth/login"' "$response_file"; then
        echo "ALB smoke response did not contain the Core Case OpenAPI login path." >&2
        rm -f "$response_file"
        return 1
    fi

    rm -f "$response_file"
    echo "ALB smoke passed: $smoke_url"
}

preflight_runtime_configuration
run_alb_smoke
