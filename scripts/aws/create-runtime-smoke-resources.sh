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

TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-147)
EC2_TAGS="ResourceType=security-group,Tags=[{Key=user,Value=amos-maddux},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-147}]"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

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

main() {
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

    echo "Creating or tagging task security groups..."
    create_or_tag_security_group "$CORE_CASE_SECURITY_GROUP_NAME" "SCRUM-147 Core Case Fargate task smoke security group."
    create_or_tag_security_group "$GL_CODING_SECURITY_GROUP_NAME" "SCRUM-147 GL-coding Fargate task smoke security group."

    echo "Creating synthetic Secrets Manager values..."
    create_jwt_secret_values
    core_db_arn="$(put_secret expenseflow/sandbox/core-case/database-url 'postgres://expenseflow_sandbox:synthetic-password@127.0.0.1:5432/expenseflow_sandbox')"
    core_private_key_arn="$(put_secret expenseflow/sandbox/core-case/auth-jwt-private-key-base64 "$JWT_PRIVATE_KEY_BASE64")"
    core_mfa_key_arn="$(put_secret expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key "$MFA_TOTP_SECRET_ENCRYPTION_KEY")"
    core_tin_username_arn="$(put_secret expenseflow/sandbox/core-case/tin-ein-validation-username synthetic-tin-ein-user)"
    core_tin_password_arn="$(put_secret expenseflow/sandbox/core-case/tin-ein-validation-password synthetic-tin-ein-password)"
    gl_db_arn="$(put_secret expenseflow/sandbox/gl-coding/database-url 'postgres://expenseflow_sandbox:synthetic-password@127.0.0.1:5432/expenseflow_sandbox')"
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

    echo "SCRUM-147 runtime smoke resources are ready."
}

main "$@"
