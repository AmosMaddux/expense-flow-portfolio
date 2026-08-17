#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIRM_RESOURCE_TEARDOWN="${CONFIRM_RESOURCE_TEARDOWN:-}"

VPC_ID="${VPC_ID:-}"
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
ALB_SECURITY_GROUP_NAME="${ALB_SECURITY_GROUP_NAME:-expenseflow-sandbox-alb-sg}"
INTERNAL_ALB_SECURITY_GROUP_NAME="${INTERNAL_ALB_SECURITY_GROUP_NAME:-expenseflow-sandbox-internal-alb-sg}"
CORE_CASE_TASK_DEFINITION="${CORE_CASE_TASK_DEFINITION:-expenseflow-core-case-service}"
GL_CODING_TASK_DEFINITION="${GL_CODING_TASK_DEFINITION:-expenseflow-gl-coding-service}"
INTERNAL_GL_CODING_SMOKE_TASK_FAMILY="${INTERNAL_GL_CODING_SMOKE_TASK_FAMILY:-expenseflow-internal-gl-coding-alb-smoke}"
RENDER_DIR="${RENDER_DIR:-/tmp/expenseflow-scrum-147-task-definitions}"
RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-expense-reports}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"
ALB_NAME="${ALB_NAME:-expenseflow-sandbox-alb}"
INTERNAL_ALB_NAME="${INTERNAL_ALB_NAME:-expenseflow-sandbox-internal-alb}"
CORE_CASE_TARGET_GROUP_NAME="${CORE_CASE_TARGET_GROUP_NAME:-expenseflow-sandbox-core-case-tg}"
GL_CODING_TARGET_GROUP_NAME="${GL_CODING_TARGET_GROUP_NAME:-expenseflow-sandbox-gl-coding-tg}"
INTERNAL_GL_CODING_TARGET_GROUP_NAME="${INTERNAL_GL_CODING_TARGET_GROUP_NAME:-expenseflow-sbox-int-gl-tg}"
LEGACY_INTERNAL_GL_CODING_TARGET_GROUP_NAME="${LEGACY_INTERNAL_GL_CODING_TARGET_GROUP_NAME:-expenseflow-sandbox-internal-gl-coding-tg}"
CORE_CASE_SERVICE_NAME="${CORE_CASE_SERVICE_NAME:-expenseflow-core-case-service}"
GL_CODING_SERVICE_NAME="${GL_CODING_SERVICE_NAME:-expenseflow-gl-coding-service}"

SECRET_NAMES=(
    expenseflow/sandbox/core-case/database-url
    expenseflow/sandbox/core-case/auth-jwt-private-key-base64
    expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key
    expenseflow/sandbox/core-case/runtime-smoke-shared-secret
    expenseflow/sandbox/core-case/tin-ein-validation-username
    expenseflow/sandbox/core-case/tin-ein-validation-password
    expenseflow/sandbox/gl-coding/database-url
    expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json
)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" ]]; then
    echo "Refusing to run destructive teardown with AWS_PROFILE=$AWS_PROFILE. Use the dedicated $EXPECTED_PROFILE sandbox profile." >&2
    exit 1
fi

if [[ "$CONFIRM_RESOURCE_TEARDOWN" != "SCRUM-147" ]]; then
    echo "Refusing to delete resources without CONFIRM_RESOURCE_TEARDOWN=SCRUM-147." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied explicitly before tearing down ECS sandbox resources." >&2
        return 1
    fi
}

require_sandbox_tag_query() {
    local label="$1"
    shift
    local is_sandbox_resource

    is_sandbox_resource="$(aws_cli "$@" --output text)"
    if [[ "$is_sandbox_resource" != "True" ]]; then
        echo "Refusing to delete $label because it does not have the expected sandbox ownership tags." >&2
        return 1
    fi
}

require_named_resource_tags() {
    local label="$1"
    shift

    require_sandbox_tag_query "$label" "$@" \
        --query "contains(Tags[?Key=='user'].Value, 'amos-maddux') && contains(Tags[?Key=='env'].Value, 'sandbox') && (contains(Tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(Tags[?Key=='ticket'].Value, 'SCRUM-148'))"
}

require_elbv2_resource_tags() {
    local label="$1"
    local resource_arn="$2"

    require_sandbox_tag_query "$label" elbv2 describe-tags \
        --resource-arns "$resource_arn" \
        --query "contains(TagDescriptions[0].Tags[?Key=='user'].Value, 'amos-maddux') && contains(TagDescriptions[0].Tags[?Key=='env'].Value, 'sandbox') && (contains(TagDescriptions[0].Tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(TagDescriptions[0].Tags[?Key=='ticket'].Value, 'SCRUM-148'))"
}

require_security_group_tags() {
    local group_id="$1"

    require_sandbox_tag_query "security group $group_id" ec2 describe-security-groups \
        --group-ids "$group_id" \
        --query "contains(SecurityGroups[0].Tags[?Key=='user'].Value, 'amos-maddux') && contains(SecurityGroups[0].Tags[?Key=='env'].Value, 'sandbox') && (contains(SecurityGroups[0].Tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(SecurityGroups[0].Tags[?Key=='ticket'].Value, 'SCRUM-148'))"
}

require_cluster_tags() {
    require_sandbox_tag_query "ECS cluster $CLUSTER_NAME" ecs describe-clusters \
        --clusters "$CLUSTER_NAME" \
        --include TAGS \
        --query "contains(clusters[0].tags[?key=='user'].value, 'amos-maddux') && contains(clusters[0].tags[?key=='env'].value, 'sandbox') && (contains(clusters[0].tags[?key=='ticket'].value, 'SCRUM-147') || contains(clusters[0].tags[?key=='ticket'].value, 'SCRUM-148'))"
}

cluster_exists() {
    local cluster_status

    cluster_status="$(aws_cli ecs describe-clusters \
        --clusters "$CLUSTER_NAME" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || true)"

    [[ -n "$cluster_status" && "$cluster_status" != "None" && "$cluster_status" != "INACTIVE" ]]
}

resolve_vpc_id() {
    local resolved_vpc_id

    if [[ -n "$VPC_ID" ]]; then
        return 0
    fi

    resolved_vpc_id="$(aws_cli ec2 describe-security-groups \
        --filters Name=group-name,Values="$ALB_SECURITY_GROUP_NAME" \
        --query 'SecurityGroups[0].VpcId' \
        --output text 2>/dev/null || true)"

    if [[ -z "$resolved_vpc_id" || "$resolved_vpc_id" == "None" ]]; then
        resolved_vpc_id="$(aws_cli ec2 describe-security-groups \
            --filters Name=group-name,Values="$CORE_CASE_SECURITY_GROUP_NAME" \
            --query 'SecurityGroups[0].VpcId' \
            --output text 2>/dev/null || true)"
    fi

    if [[ -z "$resolved_vpc_id" || "$resolved_vpc_id" == "None" ]]; then
        echo "VPC_ID could not be inferred from sandbox security groups; security-group deletion will be best-effort by tagged group name." >&2
        return 0
    fi

    VPC_ID="$resolved_vpc_id"
    echo "Resolved VPC_ID=$VPC_ID from sandbox security groups."
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

delete_service() {
    local service_name="$1"
    local service_arn service_status

    read -r service_status service_arn < <(aws_cli ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --query 'services[0].[status,serviceArn]' \
        --output text 2>/dev/null || true) || true

    if [[ -z "$service_status" || "$service_status" == "None" || "$service_status" == "INACTIVE" ]]; then
        return 0
    fi

    require_sandbox_tag_query "ECS service $service_name" ecs list-tags-for-resource \
        --resource-arn "$service_arn" \
        --query "contains(tags[?key=='user'].value, 'amos-maddux') && contains(tags[?key=='env'].value, 'sandbox') && (contains(tags[?key=='ticket'].value, 'SCRUM-147') || contains(tags[?key=='ticket'].value, 'SCRUM-148'))"

    aws_cli ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$service_name" \
        --desired-count 0 >/dev/null 2>&1 || true
    aws_cli ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" >/dev/null 2>&1 || true
    aws_cli ecs delete-service \
        --cluster "$CLUSTER_NAME" \
        --service "$service_name" \
        --force >/dev/null 2>&1 || true
    aws_cli ecs wait services-inactive \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" >/dev/null 2>&1 || true
}

load_balancer_arn() {
    local load_balancer_name="$1"

    aws_cli elbv2 describe-load-balancers \
        --names "$load_balancer_name" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text 2>/dev/null || true
}

target_group_arn() {
    aws_cli elbv2 describe-target-groups \
        --names "$1" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text 2>/dev/null || true
}

delete_load_balancer_stack() {
    local load_balancer_name="$1"
    shift
    local target_groups=("$@")
    local alb_arn listener_arns rule_arns target_group target_group_arn_value

    alb_arn="$(load_balancer_arn "$load_balancer_name")"
    if [[ -n "$alb_arn" && "$alb_arn" != "None" ]]; then
        require_elbv2_resource_tags "load balancer $load_balancer_name" "$alb_arn"
        listener_arns="$(aws_cli elbv2 describe-listeners \
            --load-balancer-arn "$alb_arn" \
            --query 'Listeners[].ListenerArn' \
            --output text 2>/dev/null || true)"

        for listener_arn in $listener_arns; do
            rule_arns="$(aws_cli elbv2 describe-rules \
                --listener-arn "$listener_arn" \
                --query 'Rules[?Priority!=`default`].RuleArn' \
                --output text 2>/dev/null || true)"
            for rule_arn in $rule_arns; do
                aws_cli elbv2 delete-rule --rule-arn "$rule_arn" >/dev/null 2>&1 || true
            done
            aws_cli elbv2 delete-listener --listener-arn "$listener_arn" >/dev/null 2>&1 || true
        done

        aws_cli elbv2 delete-load-balancer --load-balancer-arn "$alb_arn" >/dev/null 2>&1 || true
        aws_cli elbv2 wait load-balancers-deleted --load-balancer-arns "$alb_arn" >/dev/null 2>&1 || true
    fi

    for target_group in "${target_groups[@]}"; do
        target_group_arn_value="$(target_group_arn "$target_group")"
        if [[ -n "$target_group_arn_value" && "$target_group_arn_value" != "None" ]]; then
            require_elbv2_resource_tags "target group $target_group" "$target_group_arn_value"
            aws_cli elbv2 delete-target-group --target-group-arn "$target_group_arn_value" >/dev/null 2>&1 || true
        fi
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
        require_sandbox_tag_query "task definition $task_definition_arn" ecs list-tags-for-resource \
            --resource-arn "$task_definition_arn" \
            --query "contains(tags[?key=='user'].value, 'amos-maddux') && contains(tags[?key=='env'].value, 'sandbox') && (contains(tags[?key=='ticket'].value, 'SCRUM-147') || contains(tags[?key=='ticket'].value, 'SCRUM-148'))"
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
        for task_definition_arn in $inactive_task_definitions; do
            require_sandbox_tag_query "task definition $task_definition_arn" ecs list-tags-for-resource \
                --resource-arn "$task_definition_arn" \
                --query "contains(tags[?key=='user'].value, 'amos-maddux') && contains(tags[?key=='env'].value, 'sandbox') && (contains(tags[?key=='ticket'].value, 'SCRUM-147') || contains(tags[?key=='ticket'].value, 'SCRUM-148'))"
        done
        aws_cli ecs delete-task-definitions \
            --task-definitions $inactive_task_definitions >/dev/null 2>&1 || true
    fi
}

delete_repository() {
    local repository_name="$1"
    local repository_arn

    repository_arn="$(aws_cli ecr describe-repositories \
        --repository-names "$repository_name" \
        --query 'repositories[0].repositoryArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$repository_arn" || "$repository_arn" == "None" ]]; then
        return 0
    fi

    require_sandbox_tag_query "ECR repository $repository_name" ecr list-tags-for-resource \
        --resource-arn "$repository_arn" \
        --query "contains(tags[?Key=='user'].Value, 'amos-maddux') && contains(tags[?Key=='env'].Value, 'sandbox') && (contains(tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(tags[?Key=='ticket'].Value, 'SCRUM-148'))"

    aws_cli ecr delete-repository \
        --repository-name "$repository_name" \
        --force >/dev/null 2>&1 || true
}

delete_secret() {
    local secret_name="$1"

    if ! aws_cli secretsmanager describe-secret --secret-id "$secret_name" >/dev/null 2>&1; then
        return 0
    fi

    require_named_resource_tags "secret $secret_name" secretsmanager describe-secret --secret-id "$secret_name"

    aws_cli secretsmanager delete-secret \
        --secret-id "$secret_name" \
        --force-delete-without-recovery >/dev/null 2>&1 || true
}

delete_log_group() {
    local log_group_name="$1"
    local log_group_arn

    log_group_arn="$(aws_cli logs describe-log-groups \
        --log-group-name-prefix "$log_group_name" \
        --query "logGroups[?logGroupName=='$log_group_name'] | [0].logGroupName" \
        --output text 2>/dev/null || true)"

    if [[ -z "$log_group_arn" || "$log_group_arn" == "None" ]]; then
        return 0
    fi

    require_sandbox_tag_query "log group $log_group_name" logs list-tags-log-group \
        --log-group-name "$log_group_name" \
        --query "tags.user == 'amos-maddux' && tags.env == 'sandbox' && (tags.ticket == 'SCRUM-147' || tags.ticket == 'SCRUM-148')"

    aws_cli logs delete-log-group --log-group-name "$log_group_name" >/dev/null 2>&1 || true
}

delete_sns_topic() {
    local topic_name="$1"
    local topic_arn

    topic_arn="$(aws_cli sns list-topics \
        --query "Topics[?ends_with(TopicArn, ':$topic_name')].TopicArn | [0]" \
        --output text 2>/dev/null || true)"

    if [[ -n "$topic_arn" && "$topic_arn" != "None" ]]; then
        require_sandbox_tag_query "SNS topic $topic_name" sns list-tags-for-resource \
            --resource-arn "$topic_arn" \
            --query "contains(Tags[?Key=='user'].Value, 'amos-maddux') && contains(Tags[?Key=='env'].Value, 'sandbox') && (contains(Tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(Tags[?Key=='ticket'].Value, 'SCRUM-148'))"
        aws_cli sns delete-topic --topic-arn "$topic_arn" >/dev/null 2>&1 || true
    fi
}

delete_receipt_bucket() {
    local bucket_name="$1"

    if aws_cli s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        require_sandbox_tag_query "S3 bucket $bucket_name" s3api get-bucket-tagging \
            --bucket "$bucket_name" \
            --query "contains(TagSet[?Key=='user'].Value, 'amos-maddux') && contains(TagSet[?Key=='env'].Value, 'sandbox') && (contains(TagSet[?Key=='ticket'].Value, 'SCRUM-147') || contains(TagSet[?Key=='ticket'].Value, 'SCRUM-148'))"
        aws_cli s3 rm "s3://$bucket_name" --recursive >/dev/null 2>&1 || true
        aws_cli s3api delete-bucket --bucket "$bucket_name" >/dev/null 2>&1 || true
    fi
}

delete_dynamodb_table() {
    local table_name="$1"
    local table_arn

    table_arn="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query 'Table.TableArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$table_arn" || "$table_arn" == "None" ]]; then
        return 0
    fi

    require_sandbox_tag_query "DynamoDB table $table_name" dynamodb list-tags-of-resource \
        --resource-arn "$table_arn" \
        --query "contains(Tags[?Key=='user'].Value, 'amos-maddux') && contains(Tags[?Key=='env'].Value, 'sandbox') && (contains(Tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(Tags[?Key=='ticket'].Value, 'SCRUM-148'))"

    aws_cli dynamodb delete-table --table-name "$table_name" >/dev/null 2>&1 || true
}

delete_security_group() {
    local group_name="$1"
    local group_id
    local filters=(Name=group-name,Values="$group_name")

    if [[ -n "$VPC_ID" ]]; then
        filters+=(Name=vpc-id,Values="$VPC_ID")
    fi

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters "${filters[@]}" \
        --query 'SecurityGroups[0].GroupId' \
        --output text 2>/dev/null || true)"

    if [[ -n "$group_id" && "$group_id" != "None" ]]; then
        require_security_group_tags "$group_id"
        aws_cli ec2 delete-security-group --group-id "$group_id" >/dev/null 2>&1 || true
    fi
}

revoke_security_group_ingress_rules() {
    local group_name="$1"
    local group_id
    local filters=(Name=group-name,Values="$group_name")

    if [[ -n "$VPC_ID" ]]; then
        filters+=(Name=vpc-id,Values="$VPC_ID")
    fi

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters "${filters[@]}" \
        --query 'SecurityGroups[0].GroupId' \
        --output text 2>/dev/null || true)"

    if [[ -z "$group_id" || "$group_id" == "None" ]]; then
        return 0
    fi

    require_security_group_tags "$group_id"
    aws_cli ec2 revoke-security-group-ingress \
        --group-id "$group_id" \
        --ip-permissions "$(aws_cli ec2 describe-security-groups \
            --group-ids "$group_id" \
            --query 'SecurityGroups[0].IpPermissions' \
            --output json)" >/dev/null 2>&1 || true
}

delete_role() {
    local role_name="$1"
    local attached_policy_arns inline_policy_names

    if ! aws_cli iam get-role --role-name "$role_name" >/dev/null 2>&1; then
        return 0
    fi

    require_sandbox_tag_query "IAM role $role_name" iam list-role-tags \
        --role-name "$role_name" \
        --query "contains(Tags[?Key=='user'].Value, 'amos-maddux') && contains(Tags[?Key=='env'].Value, 'sandbox') && (contains(Tags[?Key=='ticket'].Value, 'SCRUM-147') || contains(Tags[?Key=='ticket'].Value, 'SCRUM-148'))"

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
    resolve_vpc_id
    if cluster_exists; then
        require_cluster_tags
    fi

    echo "Deleting SCRUM-148 ECS services..."
    if cluster_exists; then
        delete_service "$CORE_CASE_SERVICE_NAME"
        delete_service "$GL_CODING_SERVICE_NAME"
    fi

    echo "Stopping remaining SCRUM-147 smoke tasks..."
    if cluster_exists; then
        stop_cluster_tasks
    fi

    echo "Deleting public ALB, listeners, rules, and target groups..."
    delete_load_balancer_stack "$ALB_NAME" "$CORE_CASE_TARGET_GROUP_NAME" "$GL_CODING_TARGET_GROUP_NAME"

    echo "Deleting internal ALB, listener, and GL-coding target group..."
    delete_load_balancer_stack "$INTERNAL_ALB_NAME" "$INTERNAL_GL_CODING_TARGET_GROUP_NAME" "$LEGACY_INTERNAL_GL_CODING_TARGET_GROUP_NAME"

    echo "Deregistering SCRUM-147 task definition families..."
    deregister_task_definition_family "$CORE_CASE_TASK_DEFINITION"
    deregister_task_definition_family "$GL_CODING_TASK_DEFINITION"
    deregister_task_definition_family "$INTERNAL_GL_CODING_SMOKE_TASK_FAMILY"

    echo "Deleting ECS cluster..."
    if cluster_exists; then
        require_cluster_tags
        aws_cli ecs delete-cluster --cluster "$CLUSTER_NAME" >/dev/null 2>&1 || true
    fi

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

    echo "Deleting Core Case AWS runtime dependencies..."
    delete_sns_topic "$STAGE_TRANSITION_SNS_TOPIC_NAME"
    delete_receipt_bucket "$RECEIPT_STORAGE_BUCKET"
    delete_dynamodb_table "$DYNAMODB_EXPENSE_REPORT_TABLE"

    echo "Deleting task security groups..."
    revoke_security_group_ingress_rules "$CORE_CASE_SECURITY_GROUP_NAME"
    revoke_security_group_ingress_rules "$GL_CODING_SECURITY_GROUP_NAME"
    revoke_security_group_ingress_rules "$INTERNAL_ALB_SECURITY_GROUP_NAME"
    revoke_security_group_ingress_rules "$ALB_SECURITY_GROUP_NAME"
    delete_security_group "$CORE_CASE_SECURITY_GROUP_NAME"
    delete_security_group "$GL_CODING_SECURITY_GROUP_NAME"
    delete_security_group "$INTERNAL_ALB_SECURITY_GROUP_NAME"
    delete_security_group "$ALB_SECURITY_GROUP_NAME"

    echo "Deleting IAM roles and attached policies..."
    delete_role "$EXECUTION_ROLE_NAME"
    delete_role "$CORE_CASE_TASK_ROLE_NAME"
    delete_role "$GL_CODING_TASK_ROLE_NAME"

    echo "Deleting rendered local task-definition output..."
    rm -rf "$RENDER_DIR"

    echo "SCRUM-147 runtime smoke resources have been requested for teardown."
}

main "$@"
