#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
CLUSTER_NAME="${CLUSTER_NAME:-expenseflow-sandbox}"
VPC_ID="${VPC_ID:-vpc-07d74aa9f23a0a4d5}"
PUBLIC_SUBNETS="${PUBLIC_SUBNETS:-subnet-009a1b8ff487f5f03,subnet-0c860e6ff8d54bd74}"
CORE_CASE_SECURITY_GROUP_NAME="${CORE_CASE_SECURITY_GROUP_NAME:-expenseflow-sandbox-core-case-task-sg}"
GL_CODING_SECURITY_GROUP_NAME="${GL_CODING_SECURITY_GROUP_NAME:-expenseflow-sandbox-gl-coding-task-sg}"
CORE_CASE_TASK_DEFINITION="${CORE_CASE_TASK_DEFINITION:-expenseflow-core-case-service}"
GL_CODING_TASK_DEFINITION="${GL_CODING_TASK_DEFINITION:-expenseflow-gl-coding-service}"
STOP_AFTER_SMOKE="${STOP_AFTER_SMOKE:-false}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

security_group_id() {
    aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$1" \
        --query 'SecurityGroups[0].GroupId' \
        --output text
}

wait_for_container_health() {
    local task_arn="$1"
    local container_name="$2"
    local health_status last_status stopped_reason

    for _ in $(seq 1 40); do
        read -r last_status health_status stopped_reason < <(aws_cli ecs describe-tasks \
            --cluster "$CLUSTER_NAME" \
            --tasks "$task_arn" \
            --query "tasks[0].[lastStatus,containers[?name=='$container_name']|[0].healthStatus,stoppedReason]" \
            --output text)

        echo "$container_name task status=$last_status health=$health_status"

        if [[ "$last_status" == "STOPPED" ]]; then
            echo "$container_name stopped before becoming healthy: $stopped_reason" >&2
            return 1
        fi

        if [[ "$health_status" == "HEALTHY" ]]; then
            return 0
        fi

        sleep 10
    done

    echo "$container_name did not become healthy before timeout." >&2
    return 1
}

print_log_streams() {
    local log_group_name="$1"
    local stream_prefix="$2"

    aws_cli logs describe-log-streams \
        --log-group-name "$log_group_name" \
        --log-stream-name-prefix "$stream_prefix" \
        --max-items 5 \
        --query 'logStreams[].logStreamName' \
        --output text
}

run_one_task() {
    local label="$1"
    local task_definition="$2"
    local security_group_id="$3"
    local container_name="$4"
    local log_group_name="$5"
    local stream_prefix="$6"
    local task_arn

    echo "Starting $label task..."
    task_arn="$(aws_cli ecs run-task \
        --cluster "$CLUSTER_NAME" \
        --launch-type FARGATE \
        --platform-version LATEST \
        --task-definition "$task_definition" \
        --network-configuration "awsvpcConfiguration={subnets=[$PUBLIC_SUBNETS],securityGroups=[$security_group_id],assignPublicIp=ENABLED}" \
        --query 'tasks[0].taskArn' \
        --output text)"

    if [[ "$task_arn" == "None" ]]; then
        echo "ECS did not return a task ARN for $label." >&2
        return 1
    fi

    echo "$label task ARN: $task_arn"
    aws_cli ecs wait tasks-running --cluster "$CLUSTER_NAME" --tasks "$task_arn"
    wait_for_container_health "$task_arn" "$container_name"

    echo "$label recent log streams:"
    print_log_streams "$log_group_name" "$stream_prefix"

    if [[ "$STOP_AFTER_SMOKE" == "true" ]]; then
        aws_cli ecs stop-task \
            --cluster "$CLUSTER_NAME" \
            --task "$task_arn" \
            --reason "SCRUM-147 smoke completed successfully" >/dev/null
        echo "Stopped $label task after successful smoke."
    else
        echo "Leaving $label task running. Stop it with: aws ecs stop-task --profile $AWS_PROFILE --region $AWS_REGION --cluster $CLUSTER_NAME --task $task_arn"
    fi
}

core_case_sg="$(security_group_id "$CORE_CASE_SECURITY_GROUP_NAME")"
gl_coding_sg="$(security_group_id "$GL_CODING_SECURITY_GROUP_NAME")"

run_one_task "GL-coding" "$GL_CODING_TASK_DEFINITION" "$gl_coding_sg" "gl-coding-service" "/ecs/expenseflow-sandbox/gl-coding-service" "gl-coding-service"
run_one_task "Core Case" "$CORE_CASE_TASK_DEFINITION" "$core_case_sg" "core-case-service" "/ecs/expenseflow-sandbox/core-case-service" "core-case-service"
