#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

CLUSTER_NAME="${CLUSTER_NAME:-expenseflow-sandbox}"
VPC_ID="${VPC_ID:-}"
PUBLIC_SUBNETS="${PUBLIC_SUBNETS:-}"
ALB_NAME="${ALB_NAME:-expenseflow-sandbox-alb}"
INTERNAL_ALB_NAME="${INTERNAL_ALB_NAME:-expenseflow-sandbox-internal-alb}"
PUBLIC_ALB_SMOKE_BASE_URL="${PUBLIC_ALB_SMOKE_BASE_URL:-}"
CORE_CASE_TARGET_GROUP_NAME="${CORE_CASE_TARGET_GROUP_NAME:-expenseflow-sandbox-core-case-tg}"
INTERNAL_GL_CODING_TARGET_GROUP_NAME="${INTERNAL_GL_CODING_TARGET_GROUP_NAME:-expenseflow-sbox-int-gl-tg}"
CORE_CASE_SERVICE_NAME="${CORE_CASE_SERVICE_NAME:-expenseflow-core-case-service}"
GL_CODING_SERVICE_NAME="${GL_CODING_SERVICE_NAME:-expenseflow-gl-coding-service}"
CORE_CASE_CONTAINER_NAME="${CORE_CASE_CONTAINER_NAME:-core-case-service}"
GL_CODING_CONTAINER_NAME="${GL_CODING_CONTAINER_NAME:-gl-coding-service}"
CORE_CASE_CONTAINER_PORT="${CORE_CASE_CONTAINER_PORT:-3000}"
GL_CODING_CONTAINER_PORT="${GL_CODING_CONTAINER_PORT:-8001}"
CORE_CASE_SECURITY_GROUP_NAME="${CORE_CASE_SECURITY_GROUP_NAME:-expenseflow-sandbox-core-case-task-sg}"
EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-expenseflow-sandbox-ecs-task-execution-role}"
CORE_CASE_TASK_ROLE_NAME="${CORE_CASE_TASK_ROLE_NAME:-expenseflow-sandbox-core-case-task-role}"
GL_CODING_TASK_ROLE_NAME="${GL_CODING_TASK_ROLE_NAME:-expenseflow-sandbox-gl-coding-task-role}"
RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-expense-reports}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"
CORE_CASE_RUNTIME_POLICY_NAME="${CORE_CASE_RUNTIME_POLICY_NAME:-expenseflow-sandbox-scrum-147-core-case-runtime}"
CORE_CASE_RUNTIME_SMOKE_SECRET_NAME="${CORE_CASE_RUNTIME_SMOKE_SECRET_NAME:-expenseflow/sandbox/core-case/runtime-smoke-shared-secret}"
SMOKE_PATH="${SMOKE_PATH:-/v1/openapi.json}"
SMOKE_EXACT_V1_PATH="${SMOKE_EXACT_V1_PATH:-/v1}"
CORE_CASE_GL_CODING_SMOKE_PATH="${CORE_CASE_GL_CODING_SMOKE_PATH:-/v1/runtime-smoke/gl-coding}"
INTERNAL_GL_CODING_SMOKE_TASK_FAMILY="${INTERNAL_GL_CODING_SMOKE_TASK_FAMILY:-expenseflow-internal-gl-coding-alb-smoke}"
INTERNAL_GL_CODING_SMOKE_IMAGE="${INTERNAL_GL_CODING_SMOKE_IMAGE:-public.ecr.aws/docker/library/busybox:1.36}"
ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE="${ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE:-false}"

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
    local load_balancer_name="$1"

    aws_cli elbv2 describe-load-balancers \
        --names "$load_balancer_name" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text
}

load_balancer_dns_name() {
    local load_balancer_name="$1"

    aws_cli elbv2 describe-load-balancers \
        --names "$load_balancer_name" \
        --query 'LoadBalancers[0].DNSName' \
        --output text
}

public_alb_smoke_base_url() {
    if [[ -z "$PUBLIC_ALB_SMOKE_BASE_URL" ]]; then
        echo "PUBLIC_ALB_SMOKE_BASE_URL must be set to the HTTPS hostname covered by PUBLIC_ALB_CERTIFICATE_ARN." >&2
        return 1
    fi

    if [[ "$PUBLIC_ALB_SMOKE_BASE_URL" != https://* ]]; then
        echo "PUBLIC_ALB_SMOKE_BASE_URL must start with https:// so the runtime smoke token is never sent over plaintext HTTP." >&2
        return 1
    fi

    echo "${PUBLIC_ALB_SMOKE_BASE_URL%/}"
}

listener_arn_for_port() {
    local alb_arn="$1"
    local port="$2"

    aws_cli elbv2 describe-listeners \
        --load-balancer-arn "$alb_arn" \
        --query "Listeners[?Port==\`$port\`].ListenerArn | [0]" \
        --output text
}

security_group_id() {
    aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$1" \
        --query 'SecurityGroups[0].GroupId' \
        --output text
}

iam_role_arn() {
    aws_cli iam get-role --role-name "$1" --query 'Role.Arn' --output text
}

secret_value() {
    aws_cli secretsmanager get-secret-value \
        --secret-id "$1" \
        --query SecretString \
        --output text
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied explicitly before running the ECS ALB smoke." >&2
        return 1
    fi
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

assert_service_load_balancer() {
    local service_name="$1"
    local target_group_arn="$2"
    local container_name="$3"
    local container_port="$4"
    local match_count

    match_count="$(aws_cli ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --query "length(services[0].loadBalancers[?targetGroupArn=='$target_group_arn' && containerName=='$container_name' && containerPort==\`$container_port\`])" \
        --output text)"

    if [[ "$match_count" != "1" ]]; then
        echo "ECS service $service_name is not attached to $target_group_arn as $container_name:$container_port." >&2
        return 1
    fi
}

service_running_task_private_ips() {
    local service_name="$1"
    local task_arns eni_ids

    task_arns="$(aws_cli ecs list-tasks \
        --cluster "$CLUSTER_NAME" \
        --service-name "$service_name" \
        --desired-status RUNNING \
        --query 'taskArns' \
        --output text)"

    if [[ -z "$task_arns" || "$task_arns" == "None" ]]; then
        return 0
    fi

    eni_ids="$(aws_cli ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks $task_arns \
        --query "tasks[].attachments[].details[?name=='networkInterfaceId'].value" \
        --output text)"

    if [[ -z "$eni_ids" || "$eni_ids" == "None" ]]; then
        return 0
    fi

    aws_cli ec2 describe-network-interfaces \
        --network-interface-ids $eni_ids \
        --query 'NetworkInterfaces[].PrivateIpAddress' \
        --output text
}

assert_healthy_targets_match_service_tasks() {
    local label="$1"
    local service_name="$2"
    local target_group_arn="$3"
    local service_ips healthy_target_ips healthy_ip matched_any

    service_ips="$(service_running_task_private_ips "$service_name")"
    healthy_target_ips="$(aws_cli elbv2 describe-target-health \
        --target-group-arn "$target_group_arn" \
        --query "TargetHealthDescriptions[?TargetHealth.State=='healthy'].Target.Id" \
        --output text)"

    if [[ -z "$service_ips" || "$service_ips" == "None" ]]; then
        echo "$label service $service_name has no running task ENI private IPs." >&2
        return 1
    fi

    if [[ -z "$healthy_target_ips" || "$healthy_target_ips" == "None" ]]; then
        echo "$label target group has no healthy target IPs." >&2
        return 1
    fi

    matched_any="false"
    for healthy_ip in $healthy_target_ips; do
        if grep --quiet --fixed-strings --line-regexp "$healthy_ip" <<<"$(tr '[:space:]' '\n' <<<"$service_ips")"; then
            matched_any="true"
        else
            echo "$label target group has healthy IP $healthy_ip that is not a running task ENI for service $service_name." >&2
            return 1
        fi
    done

    if [[ "$matched_any" != "true" ]]; then
        echo "$label target group healthy targets did not match service $service_name running task ENIs." >&2
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

assert_listener_redirects_to_https() {
    local listener_arn="$1"
    local redirect_protocol redirect_port

    redirect_protocol="$(aws_cli elbv2 describe-listeners \
        --listener-arns "$listener_arn" \
        --query 'Listeners[0].DefaultActions[0].RedirectConfig.Protocol' \
        --output text)"
    redirect_port="$(aws_cli elbv2 describe-listeners \
        --listener-arns "$listener_arn" \
        --query 'Listeners[0].DefaultActions[0].RedirectConfig.Port' \
        --output text)"

    if [[ "$redirect_protocol" != "HTTPS" || "$redirect_port" != "443" ]]; then
        echo "HTTP listener $listener_arn does not redirect to HTTPS:443." >&2
        return 1
    fi
}

assert_listener_rule_absent() {
    local listener_arn="$1"
    local priority="$2"
    local rule_arn

    rule_arn="$(aws_cli elbv2 describe-rules \
        --listener-arn "$listener_arn" \
        --query "Rules[?Priority=='$priority'].RuleArn | [0]" \
        --output text)"

    if [[ -n "$rule_arn" && "$rule_arn" != "None" ]]; then
        echo "Listener rule priority $priority must not exist on the public ALB." >&2
        return 1
    fi
}

assert_listener_default_forward() {
    local listener_arn="$1"
    local target_group_arn="$2"
    local listener_target_group_arn

    listener_target_group_arn="$(aws_cli elbv2 describe-listeners \
        --listener-arns "$listener_arn" \
        --query 'Listeners[0].DefaultActions[0].TargetGroupArn' \
        --output text)"

    if [[ "$listener_target_group_arn" != "$target_group_arn" ]]; then
        echo "Listener $listener_arn does not default-forward to $target_group_arn." >&2
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

register_internal_gl_coding_smoke_task() {
    local health_url="$1"
    local execution_role_arn="$2"
    local task_definition_file task_definition_arn

    task_definition_file="$(mktemp)"
    SMOKE_TASK_FAMILY="$INTERNAL_GL_CODING_SMOKE_TASK_FAMILY" \
        SMOKE_IMAGE="$INTERNAL_GL_CODING_SMOKE_IMAGE" \
        SMOKE_HEALTH_URL="$health_url" \
        ECS_TASK_EXECUTION_ROLE_ARN="$execution_role_arn" \
        node -e "
const fs = require('fs');
const taskDefinition = {
  family: process.env.SMOKE_TASK_FAMILY,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: process.env.ECS_TASK_EXECUTION_ROLE_ARN,
  containerDefinitions: [{
    name: 'internal-gl-coding-alb-smoke',
    image: process.env.SMOKE_IMAGE,
    essential: true,
    command: ['sh', '-c', 'wget -q -O - \"' + process.env.SMOKE_HEALTH_URL + '\" >/dev/null']
  }]
};
fs.writeFileSync(process.argv[1], JSON.stringify(taskDefinition, null, 2));
" "$task_definition_file"

    task_definition_arn="$(aws_cli ecs register-task-definition \
        --cli-input-json "file://$task_definition_file" \
        --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-148 \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)"
    rm -f "$task_definition_file"
    echo "$task_definition_arn"
}

run_internal_gl_coding_smoke() {
    local internal_alb_dns_name health_url execution_role_arn core_case_sg task_definition_arn task_arn exit_code stopped_reason

    internal_alb_dns_name="$(load_balancer_dns_name "$INTERNAL_ALB_NAME")"
    health_url="http://$internal_alb_dns_name/health"
    execution_role_arn="$(iam_role_arn "$EXECUTION_ROLE_NAME")"
    core_case_sg="$(security_group_id "$CORE_CASE_SECURITY_GROUP_NAME")"

    echo "Calling internal GL-coding ALB smoke endpoint from ECS: $health_url"
    task_definition_arn="$(register_internal_gl_coding_smoke_task "$health_url" "$execution_role_arn")"
    task_arn="$(aws_cli ecs run-task \
        --cluster "$CLUSTER_NAME" \
        --launch-type FARGATE \
        --platform-version LATEST \
        --task-definition "$task_definition_arn" \
        --network-configuration "awsvpcConfiguration={subnets=[$PUBLIC_SUBNETS],securityGroups=[$core_case_sg],assignPublicIp=ENABLED}" \
        --query 'tasks[0].taskArn' \
        --output text)"

    if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
        aws_cli ecs deregister-task-definition --task-definition "$task_definition_arn" >/dev/null || true
        echo "Failed to start internal GL-coding ALB smoke task." >&2
        return 1
    fi

    aws_cli ecs wait tasks-stopped --cluster "$CLUSTER_NAME" --tasks "$task_arn"
    exit_code="$(aws_cli ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks "$task_arn" \
        --query 'tasks[0].containers[0].exitCode' \
        --output text)"
    stopped_reason="$(aws_cli ecs describe-tasks \
        --cluster "$CLUSTER_NAME" \
        --tasks "$task_arn" \
        --query 'tasks[0].stoppedReason' \
        --output text)"
    aws_cli ecs deregister-task-definition --task-definition "$task_definition_arn" >/dev/null || true

    if [[ "$exit_code" != "0" ]]; then
        echo "Internal GL-coding ALB smoke failed with exit code $exit_code: $stopped_reason" >&2
        return 1
    fi

    echo "Internal GL-coding ALB smoke passed: $health_url"
}

preflight_runtime_configuration() {
    local alb_arn internal_alb_arn http_listener_arn https_listener_arn internal_http_listener_arn core_tg_arn internal_gl_tg_arn stage_topic_arn

    require_non_empty VPC_ID "$VPC_ID"
    require_non_empty PUBLIC_SUBNETS "$PUBLIC_SUBNETS"

    echo "Checking public ALB, listener, and target group..."
    alb_arn="$(load_balancer_arn "$ALB_NAME")"
    http_listener_arn="$(listener_arn_for_port "$alb_arn" 80)"
    https_listener_arn="$(listener_arn_for_port "$alb_arn" 443)"
    core_tg_arn="$(target_group_arn "$CORE_CASE_TARGET_GROUP_NAME")"
    assert_listener_redirects_to_https "$http_listener_arn"
    assert_listener_rule_absent "$http_listener_arn" 90
    assert_listener_rule_absent "$http_listener_arn" 95
    assert_listener_rule_absent "$http_listener_arn" 100
    assert_listener_rule_absent "$http_listener_arn" 200
    assert_listener_rule "$https_listener_arn" 90 "$core_tg_arn"
    assert_listener_rule "$https_listener_arn" 100 "$core_tg_arn"
    assert_listener_rule_absent "$https_listener_arn" 200

    echo "Checking internal GL-coding ALB, listener, and target group..."
    internal_alb_arn="$(load_balancer_arn "$INTERNAL_ALB_NAME")"
    internal_http_listener_arn="$(listener_arn_for_port "$internal_alb_arn" 80)"
    internal_gl_tg_arn="$(target_group_arn "$INTERNAL_GL_CODING_TARGET_GROUP_NAME")"
    assert_listener_default_forward "$internal_http_listener_arn" "$internal_gl_tg_arn"

    echo "Checking ECS services..."
    assert_service_active "$CORE_CASE_SERVICE_NAME"
    assert_service_active "$GL_CODING_SERVICE_NAME"
    assert_service_load_balancer "$CORE_CASE_SERVICE_NAME" "$core_tg_arn" "$CORE_CASE_CONTAINER_NAME" "$CORE_CASE_CONTAINER_PORT"
    assert_service_load_balancer "$GL_CODING_SERVICE_NAME" "$internal_gl_tg_arn" "$GL_CODING_CONTAINER_NAME" "$GL_CODING_CONTAINER_PORT"

    echo "Checking Core Case AWS runtime dependencies..."
    stage_topic_arn="$(topic_arn "$STAGE_TRANSITION_SNS_TOPIC_NAME")"
    if [[ -z "$stage_topic_arn" || "$stage_topic_arn" == "None" ]]; then
        echo "Missing SNS topic: $STAGE_TRANSITION_SNS_TOPIC_NAME" >&2
        return 1
    fi
    if [[ "$ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE" == "true" ]]; then
        # Temporary SCRUM-148 escape hatch: the sandbox AWS Organizations SCP
        # currently denies s3:CreateBucket, and this ALB smoke only proves
        # ECS service health plus /v1 routing. Receipt storage remains
        # unverified until a dedicated bucket is provisioned by platform/IaC.
        echo "Skipping receipt bucket preflight because ALLOW_MISSING_RECEIPT_BUCKET_FOR_ALB_SMOKE=true." >&2
    else
        aws_cli s3api head-bucket --bucket "$RECEIPT_STORAGE_BUCKET" >/dev/null
    fi
    aws_cli dynamodb describe-table --table-name "$DYNAMODB_EXPENSE_REPORT_TABLE" >/dev/null

    echo "Checking ECS task roles and Core Case runtime policy..."
    aws_cli iam get-role --role-name "$CORE_CASE_TASK_ROLE_NAME" >/dev/null
    aws_cli iam get-role --role-name "$GL_CODING_TASK_ROLE_NAME" >/dev/null
    aws_cli iam get-role-policy \
        --role-name "$CORE_CASE_TASK_ROLE_NAME" \
        --policy-name "$CORE_CASE_RUNTIME_POLICY_NAME" >/dev/null

    wait_for_healthy_targets "Core Case" "$core_tg_arn"
    wait_for_healthy_targets "GL-coding internal" "$internal_gl_tg_arn"
    assert_healthy_targets_match_service_tasks "Core Case" "$CORE_CASE_SERVICE_NAME" "$core_tg_arn"
    assert_healthy_targets_match_service_tasks "GL-coding internal" "$GL_CODING_SERVICE_NAME" "$internal_gl_tg_arn"
}

run_alb_smoke() {
    local smoke_url response_file status_code

    smoke_url="$(public_alb_smoke_base_url)$SMOKE_PATH"
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

run_exact_v1_smoke() {
    local smoke_url response_file status_code

    smoke_url="$(public_alb_smoke_base_url)$SMOKE_EXACT_V1_PATH"
    response_file="$(mktemp)"

    echo "Calling exact /v1 ALB smoke endpoint: $smoke_url"
    status_code="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' "$smoke_url")"

    if [[ "$status_code" == "404" ]] && grep --quiet --line-regexp "Not found" "$response_file"; then
        echo "Exact /v1 ALB smoke hit the ALB default 404; the /v1 listener rule may not match the exact path." >&2
        rm -f "$response_file"
        return 1
    fi

    rm -f "$response_file"
    echo "Exact /v1 ALB smoke reached Core Case with HTTP $status_code: $smoke_url"
}

run_core_case_gl_coding_smoke() {
    local smoke_url response_file runtime_smoke_token status_code

    smoke_url="$(public_alb_smoke_base_url)$CORE_CASE_GL_CODING_SMOKE_PATH"
    response_file="$(mktemp)"
    runtime_smoke_token="$(secret_value "$CORE_CASE_RUNTIME_SMOKE_SECRET_NAME")"

    echo "Calling Core Case to GL-coding smoke endpoint: $smoke_url"
    status_code="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' --header "x-runtime-smoke-token: $runtime_smoke_token" "$smoke_url")"

    if [[ "$status_code" != "200" ]]; then
        echo "Core Case to GL-coding smoke failed with HTTP $status_code." >&2
        cat "$response_file" >&2
        rm -f "$response_file"
        return 1
    fi

    if ! grep --quiet '"dependency":"gl-coding"' "$response_file" ||
        ! grep --quiet '"status":"healthy"' "$response_file"; then
        echo "Core Case to GL-coding smoke response did not contain the expected dependency health payload." >&2
        cat "$response_file" >&2
        rm -f "$response_file"
        return 1
    fi

    rm -f "$response_file"
    echo "Core Case to GL-coding smoke passed: $smoke_url"
}

preflight_runtime_configuration
run_alb_smoke
run_exact_v1_smoke
run_core_case_gl_coding_smoke
run_internal_gl_coding_smoke
