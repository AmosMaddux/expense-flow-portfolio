#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

VPC_ID="${VPC_ID:-}"
CLUSTER_NAME="${CLUSTER_NAME:-expenseflow-sandbox}"
PUBLIC_SUBNETS="${PUBLIC_SUBNETS:-}"
INTERNAL_SUBNETS="${INTERNAL_SUBNETS:-$PUBLIC_SUBNETS}"
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
ALB_NAME="${ALB_NAME:-expenseflow-sandbox-alb}"
INTERNAL_ALB_NAME="${INTERNAL_ALB_NAME:-expenseflow-sandbox-internal-alb}"
PUBLIC_ALB_CERTIFICATE_ARN="${PUBLIC_ALB_CERTIFICATE_ARN:-}"
RUNTIME_SMOKE_SOURCE_CIDRS="${RUNTIME_SMOKE_SOURCE_CIDRS:-}"
CORE_CASE_TARGET_GROUP_NAME="${CORE_CASE_TARGET_GROUP_NAME:-expenseflow-sandbox-core-case-tg}"
INTERNAL_GL_CODING_TARGET_GROUP_NAME="${INTERNAL_GL_CODING_TARGET_GROUP_NAME:-expenseflow-sbox-int-gl-tg}"
ROLE_PERMISSIONS_BOUNDARY_ARN="${ROLE_PERMISSIONS_BOUNDARY_ARN:-}"
RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-expense-reports}"
DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX:-tenantId-index}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"
AUTH_JWT_KEY_ID="${AUTH_JWT_KEY_ID:-synthetic-scrum-147-key}"
REDIS_URL="${REDIS_URL:-}"
CORE_CASE_DATABASE_URL="${CORE_CASE_DATABASE_URL:-}"
GL_CODING_DATABASE_URL="${GL_CODING_DATABASE_URL:-}"

TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-147)
EC2_TAGS="ResourceType=security-group,Tags=[{Key=user,Value=amos-maddux},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-147}]"
ELB_TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-147)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied explicitly before creating ECS sandbox resources." >&2
        return 1
    fi
}

require_non_loopback_endpoint() {
    local variable_name="$1"
    local endpoint_value="$2"

    if [[ -z "$endpoint_value" ]]; then
        echo "$variable_name must be supplied explicitly before creating ECS sandbox resources." >&2
        return 1
    fi

    if [[ "$endpoint_value" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*://([^/@]*@)?(127\.0\.0\.1|localhost)(:|/|$) ]]; then
        echo "$variable_name must point at an ECS-reachable service endpoint, not $endpoint_value." >&2
        return 1
    fi
}

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

account_id() {
    aws_cli sts get-caller-identity --query Account --output text
}

aws_arn_prefix() {
    local caller_arn arn_label partition

    caller_arn="$(aws_cli sts get-caller-identity --query Arn --output text)"
    IFS=':' read -r arn_label partition _ <<<"$caller_arn"
    echo "$arn_label:$partition"
}

create_or_tag_ecr_repository() {
    local repository_name="$1"
    local repository_arn

    if ! repository_arn="$(aws_cli ecr describe-repositories --repository-names "$repository_name" --query 'repositories[0].repositoryArn' --output text 2>/dev/null)"; then
        repository_arn="$(aws_cli ecr create-repository \
            --repository-name "$repository_name" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256 \
            --tags "${TAGS[@]}" \
            --query 'repository.repositoryArn' \
            --output text)"
    fi

    aws_cli ecr tag-resource --resource-arn "$repository_arn" --tags "${TAGS[@]}"
    echo "$repository_arn"
}

create_or_tag_log_group() {
    local log_group_name="$1"
    local log_group_arn

    log_group_arn="$(aws_arn_prefix):logs:$AWS_REGION:$(account_id):log-group:$log_group_name"

    aws_cli logs create-log-group --log-group-name "$log_group_name" 2>/dev/null || true
    aws_cli logs put-retention-policy --log-group-name "$log_group_name" --retention-in-days 14
    aws_cli logs tag-resource \
        --resource-arn "$log_group_arn" \
        --tags user=amos-maddux,env=sandbox,ticket=SCRUM-147
}

create_or_tag_cluster() {
    local cluster_arn
    local cluster_status

    if ! cluster_status="$(aws_cli ecs describe-clusters --clusters "$CLUSTER_NAME" --query 'clusters[0].status' --output text 2>/dev/null)"; then
        cluster_arn="MISSING"
        cluster_status="MISSING"
    else
        cluster_arn="$(aws_cli ecs describe-clusters --clusters "$CLUSTER_NAME" --query 'clusters[0].clusterArn' --output text 2>/dev/null)"
    fi

    if [[ "$cluster_arn" == "None" || "$cluster_arn" == "MISSING" || "$cluster_status" == "INACTIVE" ]]; then
        cluster_arn="$(aws_cli ecs create-cluster \
            --cluster-name "$CLUSTER_NAME" \
            --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147 \
            --query 'cluster.clusterArn' \
            --output text)"
    fi

    aws_cli ecs tag-resource \
        --resource-arn "$cluster_arn" \
        --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147
    echo "$cluster_arn"
}

sorted_csv() {
    tr ',' '\n' <<<"$1" | sed '/^$/d' | sort | paste -sd ',' -
}

assert_csv_matches() {
    local label="$1"
    local actual_csv="$2"
    local expected_csv="$3"
    local actual_sorted expected_sorted

    actual_sorted="$(sorted_csv "$actual_csv")"
    expected_sorted="$(sorted_csv "$expected_csv")"

    if [[ "$actual_sorted" != "$expected_sorted" ]]; then
        echo "$label mismatch. Existing value is [$actual_sorted], expected [$expected_sorted]." >&2
        return 1
    fi
}

create_or_tag_load_balancer() {
    local load_balancer_name="$1"
    local security_group_id="$2"
    local scheme="$3"
    local subnets_csv="$4"
    local load_balancer_arn
    local existing_scheme existing_vpc_id existing_subnets_csv existing_security_groups_csv

    load_balancer_arn="$(aws_cli elbv2 describe-load-balancers \
        --names "$load_balancer_name" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$load_balancer_arn" || "$load_balancer_arn" == "None" ]]; then
        IFS=',' read -r -a subnet_ids <<<"$subnets_csv"
        load_balancer_arn="$(aws_cli elbv2 create-load-balancer \
            --name "$load_balancer_name" \
            --subnets "${subnet_ids[@]}" \
            --security-groups "$security_group_id" \
            --scheme "$scheme" \
            --type application \
            --ip-address-type ipv4 \
            --tags "${ELB_TAGS[@]}" \
            --query 'LoadBalancers[0].LoadBalancerArn' \
            --output text)"
        aws_cli elbv2 wait load-balancer-available --load-balancer-arns "$load_balancer_arn"
    else
        existing_scheme="$(aws_cli elbv2 describe-load-balancers \
            --names "$load_balancer_name" \
            --query 'LoadBalancers[0].Scheme' \
            --output text)"
        existing_vpc_id="$(aws_cli elbv2 describe-load-balancers \
            --names "$load_balancer_name" \
            --query 'LoadBalancers[0].VpcId' \
            --output text)"
        existing_subnets_csv="$(aws_cli elbv2 describe-load-balancers \
            --names "$load_balancer_name" \
            --query 'join(`,`, LoadBalancers[0].AvailabilityZones[].SubnetId)' \
            --output text)"
        existing_security_groups_csv="$(aws_cli elbv2 describe-load-balancers \
            --names "$load_balancer_name" \
            --query 'join(`,`, LoadBalancers[0].SecurityGroups)' \
            --output text)"
        if [[ "$existing_scheme" != "$scheme" ]]; then
            echo "Load balancer $load_balancer_name exists with scheme $existing_scheme, expected $scheme." >&2
            return 1
        fi
        if [[ "$existing_vpc_id" != "$VPC_ID" ]]; then
            echo "Load balancer $load_balancer_name exists in VPC $existing_vpc_id, expected $VPC_ID." >&2
            return 1
        fi
        assert_csv_matches "Load balancer $load_balancer_name subnets" "$existing_subnets_csv" "$subnets_csv"
        assert_csv_matches "Load balancer $load_balancer_name security groups" "$existing_security_groups_csv" "$security_group_id"
    fi

    aws_cli elbv2 add-tags --resource-arns "$load_balancer_arn" --tags "${ELB_TAGS[@]}"
    echo "$load_balancer_arn"
}

create_or_tag_target_group() {
    local target_group_name="$1"
    local port="$2"
    local target_group_arn
    local existing_vpc_id existing_port existing_protocol existing_target_type

    target_group_arn="$(aws_cli elbv2 describe-target-groups \
        --names "$target_group_name" \
        --query 'TargetGroups[0].TargetGroupArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$target_group_arn" || "$target_group_arn" == "None" ]]; then
        target_group_arn="$(aws_cli elbv2 create-target-group \
            --name "$target_group_name" \
            --protocol HTTP \
            --port "$port" \
            --vpc-id "$VPC_ID" \
            --target-type ip \
            --health-check-protocol HTTP \
            --health-check-path /health \
            --matcher HttpCode=200 \
            --tags "${ELB_TAGS[@]}" \
            --query 'TargetGroups[0].TargetGroupArn' \
            --output text)"
    else
        existing_vpc_id="$(aws_cli elbv2 describe-target-groups \
            --target-group-arns "$target_group_arn" \
            --query 'TargetGroups[0].VpcId' \
            --output text)"
        existing_port="$(aws_cli elbv2 describe-target-groups \
            --target-group-arns "$target_group_arn" \
            --query 'TargetGroups[0].Port' \
            --output text)"
        existing_protocol="$(aws_cli elbv2 describe-target-groups \
            --target-group-arns "$target_group_arn" \
            --query 'TargetGroups[0].Protocol' \
            --output text)"
        existing_target_type="$(aws_cli elbv2 describe-target-groups \
            --target-group-arns "$target_group_arn" \
            --query 'TargetGroups[0].TargetType' \
            --output text)"

        if [[ "$existing_vpc_id" != "$VPC_ID" ]]; then
            echo "Target group $target_group_name exists in VPC $existing_vpc_id, expected $VPC_ID." >&2
            return 1
        fi
        if [[ "$existing_port" != "$port" || "$existing_protocol" != "HTTP" || "$existing_target_type" != "ip" ]]; then
            echo "Target group $target_group_name exists as $existing_protocol:$existing_port targetType=$existing_target_type, expected HTTP:$port targetType=ip." >&2
            return 1
        fi
    fi

    if [[ -z "$target_group_arn" || "$target_group_arn" == "None" ]]; then
        echo "Failed to create or resolve target group $target_group_name." >&2
        return 1
    fi

    aws_cli elbv2 modify-target-group \
        --target-group-arn "$target_group_arn" \
        --health-check-protocol HTTP \
        --health-check-path /health \
        --matcher HttpCode=200 >/dev/null
    aws_cli elbv2 modify-target-group-attributes \
        --target-group-arn "$target_group_arn" \
        --attributes Key=deregistration_delay.timeout_seconds,Value=10 >/dev/null
    aws_cli elbv2 add-tags --resource-arns "$target_group_arn" --tags "${ELB_TAGS[@]}"
    echo "$target_group_arn"
}

create_or_update_http_listener() {
    local load_balancer_arn="$1"
    local default_actions="$2"
    local listener_arn

    listener_arn="$(aws_cli elbv2 describe-listeners \
        --load-balancer-arn "$load_balancer_arn" \
        --query 'Listeners[?Port==`80`].ListenerArn | [0]' \
        --output text 2>/dev/null || true)"

    if [[ -z "$listener_arn" || "$listener_arn" == "None" ]]; then
        listener_arn="$(aws_cli elbv2 create-listener \
            --load-balancer-arn "$load_balancer_arn" \
            --protocol HTTP \
            --port 80 \
            --default-actions "$default_actions" \
            --tags "${ELB_TAGS[@]}" \
            --query 'Listeners[0].ListenerArn' \
            --output text)"
    else
        aws_cli elbv2 modify-listener \
            --listener-arn "$listener_arn" \
            --default-actions "$default_actions" >/dev/null
    fi

    echo "$listener_arn"
}

create_or_update_https_listener() {
    local load_balancer_arn="$1"
    local certificate_arn="$2"
    local default_actions="$3"
    local listener_arn

    listener_arn="$(aws_cli elbv2 describe-listeners \
        --load-balancer-arn "$load_balancer_arn" \
        --query 'Listeners[?Port==`443`].ListenerArn | [0]' \
        --output text 2>/dev/null || true)"

    if [[ -z "$listener_arn" || "$listener_arn" == "None" ]]; then
        listener_arn="$(aws_cli elbv2 create-listener \
            --load-balancer-arn "$load_balancer_arn" \
            --protocol HTTPS \
            --port 443 \
            --certificates CertificateArn="$certificate_arn" \
            --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
            --default-actions "$default_actions" \
            --tags "${ELB_TAGS[@]}" \
            --query 'Listeners[0].ListenerArn' \
            --output text)"
    else
        aws_cli elbv2 modify-listener \
            --listener-arn "$listener_arn" \
            --protocol HTTPS \
            --port 443 \
            --certificates CertificateArn="$certificate_arn" \
            --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
            --default-actions "$default_actions" >/dev/null
    fi

    echo "$listener_arn"
}

create_or_update_listener_rule() {
    local listener_arn="$1"
    local priority="$2"
    local target_group_arn="$3"
    shift 3
    local conditions=("$@")
    local rule_arn

    rule_arn="$(aws_cli elbv2 describe-rules \
        --listener-arn "$listener_arn" \
        --query "Rules[?Priority=='$priority'].RuleArn | [0]" \
        --output text 2>/dev/null || true)"

    if [[ -z "$rule_arn" || "$rule_arn" == "None" ]]; then
        rule_arn="$(aws_cli elbv2 create-rule \
            --listener-arn "$listener_arn" \
            --priority "$priority" \
            --conditions "${conditions[@]}" \
            --actions Type=forward,TargetGroupArn="$target_group_arn" \
            --tags "${ELB_TAGS[@]}" \
            --query 'Rules[0].RuleArn' \
            --output text)"
    else
        aws_cli elbv2 modify-rule \
            --rule-arn "$rule_arn" \
            --conditions "${conditions[@]}" \
            --actions Type=forward,TargetGroupArn="$target_group_arn" >/dev/null
    fi

    aws_cli elbv2 add-tags --resource-arns "$rule_arn" --tags "${ELB_TAGS[@]}"
    echo "$rule_arn"
}

create_or_update_listener_rule_with_actions() {
    local listener_arn="$1"
    local priority="$2"
    local actions="$3"
    shift 3
    local conditions=("$@")
    local rule_arn

    rule_arn="$(aws_cli elbv2 describe-rules \
        --listener-arn "$listener_arn" \
        --query "Rules[?Priority=='$priority'].RuleArn | [0]" \
        --output text 2>/dev/null || true)"

    if [[ -z "$rule_arn" || "$rule_arn" == "None" ]]; then
        rule_arn="$(aws_cli elbv2 create-rule \
            --listener-arn "$listener_arn" \
            --priority "$priority" \
            --conditions "${conditions[@]}" \
            --actions "$actions" \
            --tags "${ELB_TAGS[@]}" \
            --query 'Rules[0].RuleArn' \
            --output text)"
    else
        aws_cli elbv2 modify-rule \
            --rule-arn "$rule_arn" \
            --conditions "${conditions[@]}" \
            --actions "$actions" >/dev/null
    fi

    aws_cli elbv2 add-tags --resource-arns "$rule_arn" --tags "${ELB_TAGS[@]}"
    echo "$rule_arn"
}

delete_listener_rule_by_priority() {
    local listener_arn="$1"
    local priority="$2"
    local rule_arn

    rule_arn="$(aws_cli elbv2 describe-rules \
        --listener-arn "$listener_arn" \
        --query "Rules[?Priority=='$priority'].RuleArn | [0]" \
        --output text 2>/dev/null || true)"

    if [[ -n "$rule_arn" && "$rule_arn" != "None" ]]; then
        aws_cli elbv2 delete-rule --rule-arn "$rule_arn" >/dev/null
    fi
}

create_or_tag_sns_topic() {
    local topic_name="$1"
    local topic_arn

    topic_arn="$(aws_cli sns create-topic \
        --name "$topic_name" \
        --tags "${TAGS[@]}" \
        --query TopicArn \
        --output text)"

    aws_cli sns tag-resource --resource-arn "$topic_arn" --tags "${TAGS[@]}"
    echo "$topic_arn"
}

create_or_tag_receipt_bucket() {
    local bucket_name="$1"
    local bucket_arn

    if ! aws_cli s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        if [[ "$AWS_REGION" == "us-east-1" ]]; then
            aws_cli s3api create-bucket --bucket "$bucket_name" >/dev/null || {
                echo "Failed to create receipt bucket $bucket_name. Provide an existing dedicated bucket or grant s3:CreateBucket in the sandbox." >&2
                return 1
            }
        else
            aws_cli s3api create-bucket \
                --bucket "$bucket_name" \
                --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null || {
                    echo "Failed to create receipt bucket $bucket_name. Provide an existing dedicated bucket or grant s3:CreateBucket in the sandbox." >&2
                    return 1
                }
        fi
    fi

    aws_cli s3api put-bucket-tagging \
        --bucket "$bucket_name" \
        --tagging "TagSet=[{Key=user,Value=amos-maddux},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-147}]" >/dev/null
    bucket_arn="$(aws_arn_prefix):s3:::$bucket_name"
    echo "$bucket_arn"
}

create_or_tag_expense_report_table() {
    local table_name="$1"
    local tenant_index_name="$2"
    local table_arn
    local tenant_index_status

    table_arn="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query 'Table.TableArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$table_arn" || "$table_arn" == "None" ]]; then
        table_arn="$(aws_cli dynamodb create-table \
            --table-name "$table_name" \
            --attribute-definitions \
                AttributeName=id,AttributeType=S \
                AttributeName=tenantId,AttributeType=S \
            --key-schema \
                AttributeName=id,KeyType=HASH \
            --global-secondary-indexes \
                "IndexName=$tenant_index_name,KeySchema=[{AttributeName=tenantId,KeyType=HASH}],Projection={ProjectionType=ALL}" \
            --billing-mode PAY_PER_REQUEST \
            --tags "${TAGS[@]}" \
            --query 'TableDescription.TableArn' \
            --output text)"
        aws_cli dynamodb wait table-exists --table-name "$table_name"
    fi

    tenant_index_status="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query "Table.GlobalSecondaryIndexes[?IndexName=='$tenant_index_name']|[0].IndexStatus" \
        --output text)"
    if [[ -z "$tenant_index_status" || "$tenant_index_status" == "None" ]]; then
        echo "DynamoDB table $table_name exists without required GSI $tenant_index_name." >&2
        echo "Create a new table or supply DYNAMODB_EXPENSE_REPORT_TENANT_INDEX for the existing tenant index." >&2
        return 1
    fi

    aws_cli dynamodb tag-resource --resource-arn "$table_arn" --tags "${TAGS[@]}"
    echo "$table_arn"
}

create_or_tag_security_group() {
    local group_name="$1"
    local description="$2"
    local group_id

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$group_name" \
        --query 'SecurityGroups[0].GroupId' \
        --output text)"

    if [[ "$group_id" == "None" ]]; then
        group_id="$(aws_cli ec2 create-security-group \
            --vpc-id "$VPC_ID" \
            --group-name "$group_name" \
            --description "$description" \
            --tag-specifications "$EC2_TAGS" \
            --query GroupId \
            --output text)"
    fi

    aws_cli ec2 create-tags --resources "$group_id" --tags "${TAGS[@]}"
    echo "$group_id"
}

authorize_security_group_ingress() {
    local group_id="$1"
    local port="$2"
    local source="$3"

    if [[ "$source" == sg-* ]]; then
        aws_cli ec2 authorize-security-group-ingress \
            --group-id "$group_id" \
            --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,UserIdGroupPairs=[{GroupId=$source}]" >/dev/null 2>&1 || true
    else
        aws_cli ec2 authorize-security-group-ingress \
            --group-id "$group_id" \
            --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$source}]" >/dev/null 2>&1 || true
    fi
}

revoke_security_group_ingress() {
    local group_id="$1"
    local port="$2"
    local source="$3"

    if [[ "$source" == sg-* ]]; then
        aws_cli ec2 revoke-security-group-ingress \
            --group-id "$group_id" \
            --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,UserIdGroupPairs=[{GroupId=$source}]" >/dev/null 2>&1 || true
    else
        aws_cli ec2 revoke-security-group-ingress \
            --group-id "$group_id" \
            --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$source}]" >/dev/null 2>&1 || true
    fi
}

create_or_tag_role() {
    local role_name="$1"
    local role_arn
    local trust_policy='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

    if ! role_arn="$(aws_cli iam get-role --role-name "$role_name" --query 'Role.Arn' --output text 2>/dev/null)"; then
        role_arn="$(aws_cli iam create-role \
            --role-name "$role_name" \
            --assume-role-policy-document "$trust_policy" \
            --permissions-boundary "$ROLE_PERMISSIONS_BOUNDARY_ARN" \
            --tags "${TAGS[@]}" \
            --query 'Role.Arn' \
            --output text)"
    fi

    aws_cli iam tag-role --role-name "$role_name" --tags "${TAGS[@]}"
    echo "$role_arn"
}

put_secret() {
    local secret_name="$1"
    local secret_value="$2"
    local secret_arn

    if secret_arn="$(aws_cli secretsmanager describe-secret --secret-id "$secret_name" --query ARN --output text 2>/dev/null)"; then
        aws_cli secretsmanager put-secret-value --secret-id "$secret_name" --secret-string "$secret_value" >/dev/null
    else
        secret_arn="$(aws_cli secretsmanager create-secret \
            --name "$secret_name" \
            --description "Synthetic SCRUM-147 ECS runtime smoke secret." \
            --secret-string "$secret_value" \
            --tags "${TAGS[@]}" \
            --query ARN \
            --output text)"
    fi

    aws_cli secretsmanager tag-resource --secret-id "$secret_name" --tags "${TAGS[@]}"
    echo "$secret_arn"
}

create_jwt_secret_values() {
    local temp_dir private_key public_key
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"; trap - RETURN EXIT' RETURN EXIT
    private_key="$temp_dir/scrum-147-private.pem"
    public_key="$temp_dir/scrum-147-public.pem"

    openssl genrsa -out "$private_key" 2048 >/dev/null 2>&1
    openssl rsa -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1

    JWT_PRIVATE_KEY_BASE64="$(base64 -w 0 "$private_key")"
    JWT_PUBLIC_KEYS_JSON="$(
        AUTH_JWT_KEY_ID="$AUTH_JWT_KEY_ID" PUBLIC_KEY_PATH="$public_key" node -e "
const crypto = require('crypto');
const fs = require('fs');
const key = crypto.createPublicKey(fs.readFileSync(process.env.PUBLIC_KEY_PATH));
const jwk = key.export({ format: 'jwk' });
jwk.kid = process.env.AUTH_JWT_KEY_ID;
jwk.use = 'sig';
jwk.alg = 'RS256';
process.stdout.write(JSON.stringify({ keys: [jwk] }));
"
    )"
    MFA_TOTP_SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)"
    RUNTIME_SMOKE_SHARED_SECRET="$(openssl rand -base64 32)"
}

write_execution_role_secret_policy() {
    local policy_file="$1"
    local secret_arns_csv="$2"

    SECRET_ARNS_CSV="$secret_arns_csv" node -e "
const fs = require('fs');
const secretArns = process.env.SECRET_ARNS_CSV.split(',').filter(Boolean);
fs.writeFileSync(process.argv[1], JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: ['secretsmanager:GetSecretValue'],
    Resource: secretArns
  }]
}, null, 2));
" "$policy_file"
}

write_core_case_task_role_policy() {
    local policy_file="$1"
    local topic_arn="$2"
    local bucket_arn="$3"
    local table_arn="$4"
    local tenant_index_name="$5"

    STAGE_TRANSITION_SNS_TOPIC_ARN="$topic_arn" RECEIPT_BUCKET_ARN="$bucket_arn" DYNAMODB_TABLE_ARN="$table_arn" DYNAMODB_TENANT_INDEX_NAME="$tenant_index_name" node -e "
const fs = require('fs');
const tableArn = process.env.DYNAMODB_TABLE_ARN;
const tenantIndexArn = tableArn + '/index/' + process.env.DYNAMODB_TENANT_INDEX_NAME;
fs.writeFileSync(process.argv[1], JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['sns:Publish'],
      Resource: process.env.STAGE_TRANSITION_SNS_TOPIC_ARN
    },
    {
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject'],
      Resource: process.env.RECEIPT_BUCKET_ARN + '/*'
    },
    {
      Effect: 'Allow',
      Action: ['dynamodb:DescribeTable', 'dynamodb:Query'],
      Resource: [tableArn, tenantIndexArn]
    }
  ]
}, null, 2));
" "$policy_file"
}

main() {
    require_non_empty VPC_ID "$VPC_ID"
    require_non_empty PUBLIC_SUBNETS "$PUBLIC_SUBNETS"
    require_non_empty INTERNAL_SUBNETS "$INTERNAL_SUBNETS"
    require_non_empty PUBLIC_ALB_CERTIFICATE_ARN "$PUBLIC_ALB_CERTIFICATE_ARN"
    require_non_empty RUNTIME_SMOKE_SOURCE_CIDRS "$RUNTIME_SMOKE_SOURCE_CIDRS"
    require_non_empty ROLE_PERMISSIONS_BOUNDARY_ARN "$ROLE_PERMISSIONS_BOUNDARY_ARN"
    require_non_loopback_endpoint REDIS_URL "$REDIS_URL"
    require_non_loopback_endpoint CORE_CASE_DATABASE_URL "$CORE_CASE_DATABASE_URL"
    require_non_loopback_endpoint GL_CODING_DATABASE_URL "$GL_CODING_DATABASE_URL"

    echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    aws_cli sts get-caller-identity

    echo "Creating or tagging ECR repositories..."
    create_or_tag_ecr_repository "$CORE_CASE_REPOSITORY"
    create_or_tag_ecr_repository "$GL_CODING_REPOSITORY"

    echo "Creating or tagging ECS cluster..."
    create_or_tag_cluster

    echo "Creating or tagging CloudWatch log groups..."
    create_or_tag_log_group "$CORE_CASE_LOG_GROUP"
    create_or_tag_log_group "$GL_CODING_LOG_GROUP"

    echo "Creating or tagging load balancer security groups..."
    alb_sg="$(create_or_tag_security_group "$ALB_SECURITY_GROUP_NAME" "SCRUM-147 internet-facing ALB smoke security group.")"
    internal_alb_sg="$(create_or_tag_security_group "$INTERNAL_ALB_SECURITY_GROUP_NAME" "SCRUM-148 internal GL-coding ALB security group.")"
    authorize_security_group_ingress "$alb_sg" 80 "0.0.0.0/0"
    authorize_security_group_ingress "$alb_sg" 443 "0.0.0.0/0"

    echo "Creating or tagging task security groups..."
    core_case_sg="$(create_or_tag_security_group "$CORE_CASE_SECURITY_GROUP_NAME" "SCRUM-147 Core Case Fargate service security group.")"
    gl_coding_sg="$(create_or_tag_security_group "$GL_CODING_SECURITY_GROUP_NAME" "SCRUM-147 GL-coding Fargate service security group.")"
    authorize_security_group_ingress "$core_case_sg" 3000 "$alb_sg"
    authorize_security_group_ingress "$internal_alb_sg" 80 "$core_case_sg"
    authorize_security_group_ingress "$gl_coding_sg" 8001 "$internal_alb_sg"
    revoke_security_group_ingress "$gl_coding_sg" 8001 "$alb_sg"
    revoke_security_group_ingress "$gl_coding_sg" 8001 "$core_case_sg"

    echo "Creating or tagging public ALB, target group, and listener rule..."
    alb_arn="$(create_or_tag_load_balancer "$ALB_NAME" "$alb_sg" internet-facing "$PUBLIC_SUBNETS")"
    core_case_target_group_arn="$(create_or_tag_target_group "$CORE_CASE_TARGET_GROUP_NAME" 3000)"
    http_listener_arn="$(create_or_update_http_listener "$alb_arn" '[{"Type":"redirect","RedirectConfig":{"Protocol":"HTTPS","Port":"443","StatusCode":"HTTP_301"}}]')"
    delete_listener_rule_by_priority "$http_listener_arn" 90
    delete_listener_rule_by_priority "$http_listener_arn" 95
    delete_listener_rule_by_priority "$http_listener_arn" 100
    delete_listener_rule_by_priority "$http_listener_arn" 200
    listener_arn="$(create_or_update_https_listener "$alb_arn" "$PUBLIC_ALB_CERTIFICATE_ARN" '[{"Type":"fixed-response","FixedResponseConfig":{"StatusCode":"404","ContentType":"text/plain","MessageBody":"Not found"}}]')"
    create_or_update_listener_rule \
        "$listener_arn" \
        90 \
        "$core_case_target_group_arn" \
        Field=path-pattern,Values='/v1/runtime-smoke/*' \
        Field=source-ip,Values="$RUNTIME_SMOKE_SOURCE_CIDRS"
    create_or_update_listener_rule_with_actions \
        "$listener_arn" \
        95 \
        '[{"Type":"fixed-response","FixedResponseConfig":{"StatusCode":"403","ContentType":"text/plain","MessageBody":"Forbidden"}}]' \
        Field=path-pattern,Values='/v1/runtime-smoke/*'
    create_or_update_listener_rule \
        "$listener_arn" \
        100 \
        "$core_case_target_group_arn" \
        Field=path-pattern,Values='/v1,/v1/*'
    delete_listener_rule_by_priority "$listener_arn" 200

    echo "Creating or tagging internal GL-coding ALB, target group, and listener..."
    internal_alb_arn="$(create_or_tag_load_balancer "$INTERNAL_ALB_NAME" "$internal_alb_sg" internal "$INTERNAL_SUBNETS")"
    internal_gl_coding_target_group_arn="$(create_or_tag_target_group "$INTERNAL_GL_CODING_TARGET_GROUP_NAME" 8001)"
    create_or_update_http_listener "$internal_alb_arn" "[{\"Type\":\"forward\",\"TargetGroupArn\":\"$internal_gl_coding_target_group_arn\"}]" >/dev/null
    internal_alb_dns_name="$(aws_cli elbv2 describe-load-balancers \
        --load-balancer-arns "$internal_alb_arn" \
        --query 'LoadBalancers[0].DNSName' \
        --output text)"

    echo "Creating or tagging Core Case AWS runtime dependencies..."
    stage_transition_topic_arn="$(create_or_tag_sns_topic "$STAGE_TRANSITION_SNS_TOPIC_NAME")"
    receipt_bucket_arn="$(create_or_tag_receipt_bucket "$RECEIPT_STORAGE_BUCKET")"
    expense_report_table_arn="$(create_or_tag_expense_report_table "$DYNAMODB_EXPENSE_REPORT_TABLE" "$DYNAMODB_EXPENSE_REPORT_TENANT_INDEX")"

    echo "Creating Secrets Manager values..."
    create_jwt_secret_values
    core_db_arn="$(put_secret expenseflow/sandbox/core-case/database-url "$CORE_CASE_DATABASE_URL")"
    core_private_key_arn="$(put_secret expenseflow/sandbox/core-case/auth-jwt-private-key-base64 "$JWT_PRIVATE_KEY_BASE64")"
    core_mfa_key_arn="$(put_secret expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key "$MFA_TOTP_SECRET_ENCRYPTION_KEY")"
    core_runtime_smoke_secret_arn="$(put_secret expenseflow/sandbox/core-case/runtime-smoke-shared-secret "$RUNTIME_SMOKE_SHARED_SECRET")"
    core_tin_username_arn="$(put_secret expenseflow/sandbox/core-case/tin-ein-validation-username synthetic-tin-ein-user)"
    core_tin_password_arn="$(put_secret expenseflow/sandbox/core-case/tin-ein-validation-password synthetic-tin-ein-password)"
    gl_db_arn="$(put_secret expenseflow/sandbox/gl-coding/database-url "$GL_CODING_DATABASE_URL")"
    gl_public_keys_arn="$(put_secret expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json "$JWT_PUBLIC_KEYS_JSON")"

    echo "Creating or tagging IAM roles..."
    create_or_tag_role "$EXECUTION_ROLE_NAME"
    create_or_tag_role "$CORE_CASE_TASK_ROLE_NAME"
    create_or_tag_role "$GL_CODING_TASK_ROLE_NAME"

    aws_cli iam attach-role-policy \
        --role-name "$EXECUTION_ROLE_NAME" \
        --policy-arn "$(aws_arn_prefix):iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"

    policy_file="$(mktemp)"
    write_execution_role_secret_policy "$policy_file" "$core_db_arn,$core_private_key_arn,$core_mfa_key_arn,$core_runtime_smoke_secret_arn,$core_tin_username_arn,$core_tin_password_arn,$gl_db_arn,$gl_public_keys_arn"
    aws_cli iam put-role-policy \
        --role-name "$EXECUTION_ROLE_NAME" \
        --policy-name expenseflow-sandbox-scrum-147-secrets-read \
        --policy-document "file://$policy_file"
    rm -f "$policy_file"

    policy_file="$(mktemp)"
    write_core_case_task_role_policy "$policy_file" "$stage_transition_topic_arn" "$receipt_bucket_arn" "$expense_report_table_arn" "$DYNAMODB_EXPENSE_REPORT_TENANT_INDEX"
    aws_cli iam put-role-policy \
        --role-name "$CORE_CASE_TASK_ROLE_NAME" \
        --policy-name expenseflow-sandbox-scrum-147-core-case-runtime \
        --policy-document "file://$policy_file"
    rm -f "$policy_file"

    echo "SCRUM-147 runtime smoke resources are ready."
    echo "Internal GL-coding ALB DNS name: $internal_alb_dns_name"
    echo "Use GL_CODING_SERVICE_BASE_URL=http://$internal_alb_dns_name when registering Core Case."
}

main "$@"
