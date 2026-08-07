#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
CONFIRM_RESOURCE_TEARDOWN="${CONFIRM_RESOURCE_TEARDOWN:-}"

VPC_ID="${VPC_ID:-vpc-07d74aa9f23a0a4d5}"
CLUSTER_NAME="${CLUSTER_NAME:-expenseflow-sandbox}"
CORE_CASE_REPOSITORY="${CORE_CASE_REPOSITORY:-expenseflow-core-case-service}"
GL_CODING_REPOSITORY="${GL_CODING_REPOSITORY:-expenseflow-gl-coding-service}"
CORE_CASE_LOG_GROUP="${CORE_CASE_LOG_GROUP:-/ecs/expenseflow-sandbox/core-case-service}"
GL_CODING_LOG_GROUP="${GL_CODING_LOG_GROUP:-/ecs/expenseflow-sandbox/gl-coding-service}"
EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-expenseflow-sandbox-ecs-task-execution-role}"
CORE_CASE_TASK_ROLE_NAME="${CORE_CASE_TASK_ROLE_NAME:-expenseflow-sandbox-core-case-task-role}"
GL_CODING_TASK_ROLE_NAME="${GL_CODING_TASK_ROLE_NAME:-expenseflow-sandbox-gl-coding-task-role}"
CORE_CASE_SECURITY_GROUP_NAME="${CORE_CASE_SECURITY_GROUP_NAME:-expenseflow-sandbox-core-case-task-sg}"
GL_CODING_SECURITY_GROUP_NAME="${GL_CODING_SECURITY_GROUP_NAME:-expenseflow-sandbox-gl-coding-task-sg}"
CORE_CASE_TASK_DEFINITION="${CORE_CASE_TASK_DEFINITION:-expenseflow-core-case-service}"
GL_CODING_TASK_DEFINITION="${GL_CODING_TASK_DEFINITION:-expenseflow-gl-coding-service}"
RENDER_DIR="${RENDER_DIR:-/tmp/expenseflow-scrum-147-task-definitions}"

SECRET_NAMES=(
    expenseflow/sandbox/core-case/database-url
    expenseflow/sandbox/core-case/auth-jwt-private-key-base64
    expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key
    expenseflow/sandbox/core-case/tin-ein-validation-username
    expenseflow/sandbox/core-case/tin-ein-validation-password
    expenseflow/sandbox/gl-coding/database-url
    expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json
)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

if [[ "$CONFIRM_RESOURCE_TEARDOWN" != "SCRUM-147" ]]; then
    echo "Refusing to delete resources without CONFIRM_RESOURCE_TEARDOWN=SCRUM-147." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

stop_cluster_tasks() {
    local desired_status task_arns

    for desired_status in RUNNING PENDING; do
        task_arns="$(aws_cli ecs list-tasks \
            --cluster "$CLUSTER_NAME" \
            --desired-status "$desired_status" \
            --query 'taskArns[]' \
            --output text 2>/dev/null || true)"

        if [[ -z "$task_arns" || "$task_arns" == "None" ]]; then
            continue
        fi

        for task_arn in $task_arns; do
            aws_cli ecs stop-task \
                --cluster "$CLUSTER_NAME" \
                --task "$task_arn" \
                --reason "SCRUM-147 runtime smoke teardown" >/dev/null || true
        done

        aws_cli ecs wait tasks-stopped --cluster "$CLUSTER_NAME" --tasks $task_arns || true
    done
}

deregister_task_definition_family() {
    local family="$1"
    local active_task_definitions inactive_task_definitions

    active_task_definitions="$(aws_cli ecs list-task-definitions \
        --family-prefix "$family" \
        --status ACTIVE \
        --query 'taskDefinitionArns[]' \
        --output text 2>/dev/null || true)"

    for task_definition_arn in $active_task_definitions; do
        aws_cli ecs deregister-task-definition \
            --task-definition "$task_definition_arn" >/dev/null || true
    done

    sleep 5

    inactive_task_definitions="$(aws_cli ecs list-task-definitions \
        --family-prefix "$family" \
        --status INACTIVE \
        --query 'taskDefinitionArns[]' \
        --output text 2>/dev/null || true)"

    if [[ -n "$inactive_task_definitions" && "$inactive_task_definitions" != "None" ]]; then
        aws_cli ecs delete-task-definitions \
            --task-definitions $inactive_task_definitions >/dev/null 2>&1 || true
    fi
}

delete_repository() {
    local repository_name="$1"

    aws_cli ecr delete-repository \
        --repository-name "$repository_name" \
        --force >/dev/null 2>&1 || true
}

delete_secret() {
    local secret_name="$1"

    aws_cli secretsmanager delete-secret \
        --secret-id "$secret_name" \
        --force-delete-without-recovery >/dev/null 2>&1 || true
}

delete_log_group() {
    local log_group_name="$1"

    aws_cli logs delete-log-group --log-group-name "$log_group_name" >/dev/null 2>&1 || true
}

delete_security_group() {
    local group_name="$1"
    local group_id

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$group_name" \
        --query 'SecurityGroups[0].GroupId' \
        --output text 2>/dev/null || true)"

    if [[ -n "$group_id" && "$group_id" != "None" ]]; then
        aws_cli ec2 delete-security-group --group-id "$group_id" >/dev/null 2>&1 || true
    fi
}

delete_role() {
    local role_name="$1"
    local attached_policy_arns inline_policy_names

    inline_policy_names="$(aws_cli iam list-role-policies \
        --role-name "$role_name" \
        --query 'PolicyNames[]' \
        --output text 2>/dev/null || true)"

    for policy_name in $inline_policy_names; do
        aws_cli iam delete-role-policy \
            --role-name "$role_name" \
            --policy-name "$policy_name" >/dev/null 2>&1 || true
    done

    attached_policy_arns="$(aws_cli iam list-attached-role-policies \
        --role-name "$role_name" \
        --query 'AttachedPolicies[].PolicyArn' \
        --output text 2>/dev/null || true)"

    for policy_arn in $attached_policy_arns; do
        aws_cli iam detach-role-policy \
            --role-name "$role_name" \
            --policy-arn "$policy_arn" >/dev/null 2>&1 || true
    done

    aws_cli iam delete-role --role-name "$role_name" >/dev/null 2>&1 || true
}

main() {
    echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    aws_cli sts get-caller-identity

    echo "Stopping SCRUM-147 smoke tasks..."
    stop_cluster_tasks

    echo "Deregistering SCRUM-147 task definition families..."
    deregister_task_definition_family "$CORE_CASE_TASK_DEFINITION"
    deregister_task_definition_family "$GL_CODING_TASK_DEFINITION"

    echo "Deleting ECS cluster..."
    aws_cli ecs delete-cluster --cluster "$CLUSTER_NAME" >/dev/null 2>&1 || true

    echo "Deleting ECR repositories..."
    delete_repository "$CORE_CASE_REPOSITORY"
    delete_repository "$GL_CODING_REPOSITORY"

    echo "Deleting synthetic Secrets Manager entries..."
    for secret_name in "${SECRET_NAMES[@]}"; do
        delete_secret "$secret_name"
    done

    echo "Deleting CloudWatch log groups..."
    delete_log_group "$CORE_CASE_LOG_GROUP"
    delete_log_group "$GL_CODING_LOG_GROUP"

    echo "Deleting task security groups..."
    delete_security_group "$CORE_CASE_SECURITY_GROUP_NAME"
    delete_security_group "$GL_CODING_SECURITY_GROUP_NAME"

    echo "Deleting IAM roles and attached policies..."
    delete_role "$EXECUTION_ROLE_NAME"
    delete_role "$CORE_CASE_TASK_ROLE_NAME"
    delete_role "$GL_CODING_TASK_ROLE_NAME"

    echo "Deleting rendered local task-definition output..."
    rm -rf "$RENDER_DIR"

    echo "SCRUM-147 runtime smoke resources have been requested for teardown."
}

main "$@"
