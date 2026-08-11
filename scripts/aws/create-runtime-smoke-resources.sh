#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

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
ROLE_PERMISSIONS_BOUNDARY_ARN="${ROLE_PERMISSIONS_BOUNDARY_ARN:-arn:aws:iam::208096650110:policy/TraineeSandboxBoundary}"
RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-expense-reports}"
DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX:-tenantId-index}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"
GL_CODING_SERVICE_BASE_URL="${GL_CODING_SERVICE_BASE_URL:-}"
REDIS_URL="${REDIS_URL:-}"
CORE_CASE_DATABASE_URL="${CORE_CASE_DATABASE_URL:-}"
GL_CODING_DATABASE_URL="${GL_CODING_DATABASE_URL:-}"

TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-147)
EC2_TAGS="ResourceType=security-group,Tags=[{Key=user,Value=amos-maddux},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-147}]"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

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
    local log_group_arn="arn:aws:logs:$AWS_REGION:$(account_id):log-group:$log_group_name"

    aws_cli logs create-log-group --log-group-name "$log_group_name" 2>/dev/null || true
    aws_cli logs put-retention-policy --log-group-name "$log_group_name" --retention-in-days 14
    aws_cli logs tag-resource \
        --resource-arn "$log_group_arn" \
        --tags user=amos-maddux,env=sandbox,ticket=SCRUM-147
}

create_or_tag_cluster() {
    local cluster_arn

    if ! cluster_arn="$(aws_cli ecs describe-clusters --clusters "$CLUSTER_NAME" --query 'clusters[0].clusterArn' --output text 2>/dev/null)"; then
        cluster_arn="MISSING"
    fi

    if [[ "$cluster_arn" == "None" || "$cluster_arn" == "MISSING" ]]; then
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

    if ! aws_cli s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        if [[ "$AWS_REGION" == "us-east-1" ]]; then
            aws_cli s3api create-bucket --bucket "$bucket_name" >/dev/null
        else
            aws_cli s3api create-bucket \
                --bucket "$bucket_name" \
                --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
        fi
    fi

    aws_cli s3api put-bucket-tagging \
        --bucket "$bucket_name" \
        --tagging "TagSet=[{Key=user,Value=amos-maddux},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-147}]" >/dev/null
    echo "arn:aws:s3:::$bucket_name"
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
    private_key="$temp_dir/scrum-147-private.pem"
    public_key="$temp_dir/scrum-147-public.pem"

    openssl genrsa -out "$private_key" 2048 >/dev/null 2>&1
    openssl rsa -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1

    JWT_PRIVATE_KEY_BASE64="$(base64 -w 0 "$private_key")"
    JWT_PUBLIC_KEY_BASE64="$(base64 -w 0 "$public_key")"
    JWT_PUBLIC_KEYS_JSON="$(printf '{"synthetic-scrum-147-key":"%s"}' "$JWT_PUBLIC_KEY_BASE64")"
    MFA_TOTP_SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)"

    rm -rf "$temp_dir"
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
    require_non_loopback_endpoint GL_CODING_SERVICE_BASE_URL "$GL_CODING_SERVICE_BASE_URL"
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

    echo "Creating or tagging Core Case AWS runtime dependencies..."
    stage_transition_topic_arn="$(create_or_tag_sns_topic "$STAGE_TRANSITION_SNS_TOPIC_NAME")"
    receipt_bucket_arn="$(create_or_tag_receipt_bucket "$RECEIPT_STORAGE_BUCKET")"
    expense_report_table_arn="$(create_or_tag_expense_report_table "$DYNAMODB_EXPENSE_REPORT_TABLE" "$DYNAMODB_EXPENSE_REPORT_TENANT_INDEX")"

    echo "Creating or tagging task security groups..."
    create_or_tag_security_group "$CORE_CASE_SECURITY_GROUP_NAME" "SCRUM-147 Core Case Fargate task smoke security group."
    create_or_tag_security_group "$GL_CODING_SECURITY_GROUP_NAME" "SCRUM-147 GL-coding Fargate task smoke security group."

    echo "Creating Secrets Manager values..."
    create_jwt_secret_values
    core_db_arn="$(put_secret expenseflow/sandbox/core-case/database-url "$CORE_CASE_DATABASE_URL")"
    core_private_key_arn="$(put_secret expenseflow/sandbox/core-case/auth-jwt-private-key-base64 "$JWT_PRIVATE_KEY_BASE64")"
    core_mfa_key_arn="$(put_secret expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key "$MFA_TOTP_SECRET_ENCRYPTION_KEY")"
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
        --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

    policy_file="$(mktemp)"
    write_execution_role_secret_policy "$policy_file" "$core_db_arn,$core_private_key_arn,$core_mfa_key_arn,$core_tin_username_arn,$core_tin_password_arn,$gl_db_arn,$gl_public_keys_arn"
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
}

main "$@"
