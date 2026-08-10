#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

CLUSTER_NAME="${CLUSTER_NAME:-expenseflow-sandbox}"
VPC_ID="${VPC_ID:-}"
PUBLIC_SUBNETS="${PUBLIC_SUBNETS:-}"
CORE_CASE_SECURITY_GROUP_NAME="${CORE_CASE_SECURITY_GROUP_NAME:-expenseflow-sandbox-core-case-task-sg}"
GL_CODING_SECURITY_GROUP_NAME="${GL_CODING_SECURITY_GROUP_NAME:-expenseflow-sandbox-gl-coding-task-sg}"
ALB_NAME="${ALB_NAME:-expenseflow-sandbox-alb}"
INTERNAL_ALB_NAME="${INTERNAL_ALB_NAME:-expenseflow-sandbox-internal-alb}"
CORE_CASE_TARGET_GROUP_NAME="${CORE_CASE_TARGET_GROUP_NAME:-expenseflow-sandbox-core-case-tg}"
INTERNAL_GL_CODING_TARGET_GROUP_NAME="${INTERNAL_GL_CODING_TARGET_GROUP_NAME:-expenseflow-sandbox-internal-gl-coding-tg}"
CORE_CASE_SERVICE_NAME="${CORE_CASE_SERVICE_NAME:-expenseflow-core-case-service}"
GL_CODING_SERVICE_NAME="${GL_CODING_SERVICE_NAME:-expenseflow-gl-coding-service}"
CORE_CASE_TASK_DEFINITION="${CORE_CASE_TASK_DEFINITION:-expenseflow-core-case-service}"
GL_CODING_TASK_DEFINITION="${GL_CODING_TASK_DEFINITION:-expenseflow-gl-coding-service}"
DESIRED_COUNT="${DESIRED_COUNT:-1}"
HEALTH_CHECK_GRACE_PERIOD_SECONDS="${HEALTH_CHECK_GRACE_PERIOD_SECONDS:-60}"

TAGS=(key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied explicitly before deploying ECS sandbox services." >&2
        return 1
    fi
}

security_group_id() {
    aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$1" \
        --query 'SecurityGroups[0].GroupId' \
        --output text
}

target_group_arn() {
    aws_cli elbv2 describe-target-groups \
        --names "$1" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text
}

load_balancer_dns_name() {
    local load_balancer_name="$1"

    aws_cli elbv2 describe-load-balancers \
        --names "$load_balancer_name" \
        --query 'LoadBalancers[0].DNSName' \
        --output text
}

service_exists() {
    local service_name="$1"
    local status

    status="$(aws_cli ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --query 'services[0].status' \
        --output text 2>/dev/null || true)"

    [[ "$status" == "ACTIVE" || "$status" == "DRAINING" ]]
}

create_or_update_service() {
    local service_name="$1"
    local task_definition="$2"
    local security_group_id="$3"
    local target_group_arn="$4"
    local container_name="$5"
    local container_port="$6"

    if service_exists "$service_name"; then
        echo "Updating ECS service $service_name..." >&2
        aws_cli ecs update-service \
            --cluster "$CLUSTER_NAME" \
            --service "$service_name" \
            --task-definition "$task_definition" \
            --desired-count "$DESIRED_COUNT" \
            --health-check-grace-period-seconds "$HEALTH_CHECK_GRACE_PERIOD_SECONDS" \
            --network-configuration "awsvpcConfiguration={subnets=[$PUBLIC_SUBNETS],securityGroups=[$security_group_id],assignPublicIp=ENABLED}" \
            --load-balancers "targetGroupArn=$target_group_arn,containerName=$container_name,containerPort=$container_port" \
            --force-new-deployment >/dev/null
    else
        echo "Creating ECS service $service_name..." >&2
        aws_cli ecs create-service \
            --cluster "$CLUSTER_NAME" \
            --service-name "$service_name" \
            --launch-type FARGATE \
            --platform-version LATEST \
            --task-definition "$task_definition" \
            --desired-count "$DESIRED_COUNT" \
            --health-check-grace-period-seconds "$HEALTH_CHECK_GRACE_PERIOD_SECONDS" \
            --network-configuration "awsvpcConfiguration={subnets=[$PUBLIC_SUBNETS],securityGroups=[$security_group_id],assignPublicIp=ENABLED}" \
            --load-balancers "targetGroupArn=$target_group_arn,containerName=$container_name,containerPort=$container_port" \
            --tags "${TAGS[@]}" \
            --enable-ecs-managed-tags >/dev/null
    fi

    aws_cli ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$service_name"
    aws_cli ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --query 'services[0].serviceArn' \
        --output text
}

main() {
    require_non_empty VPC_ID "$VPC_ID"
    require_non_empty PUBLIC_SUBNETS "$PUBLIC_SUBNETS"

    echo "Resolving ALB target groups and task security groups..."
    core_case_sg="$(security_group_id "$CORE_CASE_SECURITY_GROUP_NAME")"
    gl_coding_sg="$(security_group_id "$GL_CODING_SECURITY_GROUP_NAME")"
    core_case_target_group_arn="$(target_group_arn "$CORE_CASE_TARGET_GROUP_NAME")"
    gl_coding_target_group_arn="$(target_group_arn "$INTERNAL_GL_CODING_TARGET_GROUP_NAME")"

    core_case_service_arn="$(
        create_or_update_service \
            "$CORE_CASE_SERVICE_NAME" \
            "$CORE_CASE_TASK_DEFINITION" \
            "$core_case_sg" \
            "$core_case_target_group_arn" \
            core-case-service \
            3000
    )"
    gl_coding_service_arn="$(
        create_or_update_service \
            "$GL_CODING_SERVICE_NAME" \
            "$GL_CODING_TASK_DEFINITION" \
            "$gl_coding_sg" \
            "$gl_coding_target_group_arn" \
            gl-coding-service \
            8001
    )"

    alb_dns_name="$(load_balancer_dns_name "$ALB_NAME")"
    internal_alb_dns_name="$(load_balancer_dns_name "$INTERNAL_ALB_NAME")"

    echo "Core Case service ARN: $core_case_service_arn"
    echo "GL-coding service ARN: $gl_coding_service_arn"
    echo "ALB DNS name: $alb_dns_name"
    echo "Internal GL-coding ALB DNS name: $internal_alb_dns_name"
}

main "$@"
