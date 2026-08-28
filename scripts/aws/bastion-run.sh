#!/usr/bin/env bash
set -euo pipefail

# Runs a command against the sandbox database via the permanent bastion
# (infra/terraform/modules/bastion), over SSM Session Manager - no tunnel or
# SSH key required. The bastion has Docker installed by user-data and pulls
# the same core-case-service image ECS runs, so these commands use the exact
# migration/seed/MFA logic that's actually deployed.
#
# Usage:
#   scripts/aws/bastion-run.sh migrate
#   scripts/aws/bastion-run.sh seed
#   scripts/aws/bastion-run.sh demo-seed
#   scripts/aws/bastion-run.sh code <account-name-or-alias>
#
# "code" accounts: employee-1, employee-1b, employee-2, employee-2b,
# manager-1, manager-2, finance-admin-1, finance-admin-2, platform-admin-1,
# platform-admin-2 (or the aliases employee/manager/finance-admin/platform-admin,
# which resolve to the "-1" tenant). All accounts share EXPENSEFLOW_DEV_PASSWORD
# below. See backend/core-case-service/src/dev/localAuthConfig.ts.
#
# "demo-seed" additionally creates GL codes, one demo expense report with line
# items, and synthetic receipt files uploaded to the real sandbox receipts S3
# bucket (RECEIPT_STORAGE_BUCKET). The bucket name is resolved from Terraform
# output by default. The bastion's IAM role must have PutObject/HeadObject
# there (see receipt_storage_bucket_arn on the bastion module).
#
# The script resolves its common sandbox values from Terraform outputs and AWS
# APIs by default. Override any value with an environment variable when needed.
# demo-seed additionally requires RECEIPT_STORAGE_BUCKET, which is also
# resolved from Terraform output when possible. The RDS-managed master secret
# (manage_master_user_password = true) only contains username/password, not
# host/dbname, so those two are passed separately rather than parsed from the
# secret.
#
# CORE_CASE_IMAGE_TAG is resolved from the running ECS task definition by
# default. If that lookup fails, pass the deployed image tag explicitly.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
export AWS_PAGER=""
EXPENSEFLOW_DEV_PASSWORD="${EXPENSEFLOW_DEV_PASSWORD:-expenseflow-local-dev-only}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
NAME_PREFIX="${NAME_PREFIX:-expenseflow-sandbox}"
AUTO_RESOLVE_SANDBOX_ENV="${AUTO_RESOLVE_SANDBOX_ENV:-true}"
MFA_TOTP_SECRET_ID="${MFA_TOTP_SECRET_ID:-expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key}"
CORE_CASE_IMAGE_TAG="${CORE_CASE_IMAGE_TAG:-}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

command="${1:-}"
account="${2:-}"
demo_seed_env=""

case "$command" in
    migrate)
        node_command="node backend/core-case-service/dist/db/runMigrationsCli.js"
        ;;
    seed)
        node_command="node backend/core-case-service/dist/dev/localAuthUser.js seed"
        ;;
    demo-seed)
        node_command="node backend/core-case-service/dist/dev/localDemoSeed.js"
        ;;
    code)
        if [[ -z "$account" ]]; then
            echo "Usage: $0 code <account-name-or-alias>" >&2
            exit 1
        fi
        node_command="node backend/core-case-service/dist/dev/localAuthUser.js code '$account'"
        ;;
    *)
        echo "Usage: $0 {migrate|seed|demo-seed|code <account>}" >&2
        exit 1
        ;;
esac

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

terraform_output() {
    terraform -chdir="$TERRAFORM_DIR" output -raw "$1" 2>/dev/null || true
}

describe_secret_arn() {
    aws_cli secretsmanager describe-secret \
        --secret-id "$1" \
        --query ARN \
        --output text 2>/dev/null || true
}

running_core_case_image() {
    aws_cli ecs describe-task-definition \
        --task-definition "${NAME_PREFIX}-core-case-service" \
        --query 'taskDefinition.containerDefinitions[0].image' \
        --output text 2>/dev/null || true
}

resolve_sandbox_env() {
    if [[ "$AUTO_RESOLVE_SANDBOX_ENV" != "true" ]]; then
        return 0
    fi

    BASTION_INSTANCE_ID="${BASTION_INSTANCE_ID:-$(terraform_output bastion_instance_id)}"
    CORE_CASE_DB_MASTER_USER_SECRET_ARN="${CORE_CASE_DB_MASTER_USER_SECRET_ARN:-$(terraform_output core_case_db_master_user_secret_arn)}"
    CORE_CASE_DB_HOST="${CORE_CASE_DB_HOST:-$(terraform_output core_case_db_endpoint | cut -d: -f1)}"
    CORE_CASE_DB_NAME="${CORE_CASE_DB_NAME:-core_case}"
    MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN="${MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN:-$(describe_secret_arn "$MFA_TOTP_SECRET_ID")}"
    CORE_CASE_IMAGE_URI="${CORE_CASE_IMAGE_URI:-$(terraform_output core_case_repository_url)}"

    if [[ -z "$CORE_CASE_IMAGE_TAG" ]]; then
        local image
        image="$(running_core_case_image)"
        if [[ "$image" == *:* && "$image" != *@* ]]; then
            CORE_CASE_IMAGE_TAG="${image##*:}"
        fi
    fi

    if [[ "$command" == "demo-seed" ]]; then
        RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-$(terraform_output receipt_storage_bucket_name)}"
    fi
}

resolve_sandbox_env

: "${BASTION_INSTANCE_ID:?BASTION_INSTANCE_ID is required. Run: terraform -chdir=infra/terraform/environments/sandbox output -raw bastion_instance_id}"
: "${CORE_CASE_DB_MASTER_USER_SECRET_ARN:?CORE_CASE_DB_MASTER_USER_SECRET_ARN is required. Run: terraform -chdir=infra/terraform/environments/sandbox output -raw core_case_db_master_user_secret_arn}"
: "${CORE_CASE_DB_HOST:?CORE_CASE_DB_HOST is required. Run: terraform -chdir=infra/terraform/environments/sandbox output -json | jq -r .core_case_db_endpoint.value | cut -d: -f1}"
: "${CORE_CASE_DB_NAME:?CORE_CASE_DB_NAME is required (the database name, e.g. core_case).}"
: "${MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN:?MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN is required (same ARN passed as core_case_mfa_totp_secret_encryption_key_secret_arn on terraform apply).}"
: "${CORE_CASE_IMAGE_URI:?CORE_CASE_IMAGE_URI is required. Run: terraform -chdir=infra/terraform/environments/sandbox output -raw core_case_repository_url}"
: "${CORE_CASE_IMAGE_TAG:?CORE_CASE_IMAGE_TAG is required. Run: aws ecs describe-task-definition --task-definition ${NAME_PREFIX}-core-case-service --query 'taskDefinition.containerDefinitions[0].image' --output text}"

if [[ "$command" == "demo-seed" ]]; then
    : "${RECEIPT_STORAGE_BUCKET:?RECEIPT_STORAGE_BUCKET is required for demo-seed. Run: terraform -chdir=infra/terraform/environments/sandbox output -raw receipt_storage_bucket_name}"
    demo_seed_env="-e RECEIPT_STORAGE_BUCKET=$RECEIPT_STORAGE_BUCKET -e ALLOW_NON_LOOPBACK_RECEIPT_SEED=true"
fi

if [[ "$CORE_CASE_IMAGE_URI" == *:* && "$CORE_CASE_IMAGE_URI" != *@* ]]; then
    CORE_CASE_IMAGE_TAG="${CORE_CASE_IMAGE_URI##*:}"
    CORE_CASE_IMAGE_URI="${CORE_CASE_IMAGE_URI%:*}"
fi

registry="${CORE_CASE_IMAGE_URI%%/*}"

# Each array element is one shell command SSM runs in sequence on the
# bastion. The master secret and MFA key are read there (via jq, not Node -
# the bastion has Docker but not a Node runtime outside the container) and
# injected into the container's environment; they never transit through or
# get printed by this script.
remote_commands=$(jq -nc \
    --arg region "$AWS_REGION" \
    --arg registry "$registry" \
    --arg image "$CORE_CASE_IMAGE_URI:$CORE_CASE_IMAGE_TAG" \
    --arg db_secret_arn "$CORE_CASE_DB_MASTER_USER_SECRET_ARN" \
    --arg db_host "$CORE_CASE_DB_HOST" \
    --arg db_name "$CORE_CASE_DB_NAME" \
    --arg mfa_secret_arn "$MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN" \
    --arg dev_password "$EXPENSEFLOW_DEV_PASSWORD" \
    --arg node_command "$node_command" \
    --arg demo_seed_env "$demo_seed_env" \
    --arg aws_region_env "$AWS_REGION" \
    '[
        "set -euo pipefail",
        "aws ecr get-login-password --region \($region) | docker login --username AWS --password-stdin \($registry)",
        "docker pull \($image)",
        "secret=$(aws secretsmanager get-secret-value --secret-id \($db_secret_arn) --query SecretString --output text --region \($region))",
        "database_url=$(echo \"$secret\" | jq -r \"\\\"postgres://\\\\(.username|@uri):\\\\(.password|@uri)@\($db_host):5432/\($db_name)?uselibpqcompat=true&sslmode=require\\\"\")",
        "mfa_key=$(aws secretsmanager get-secret-value --secret-id \($mfa_secret_arn) --query SecretString --output text --region \($region))",
        "docker run --rm -e DATABASE_URL=\"$database_url\" -e VITE_TENANT_ID=8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb -e VITE_SECONDARY_TENANT_ID=8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fc -e EXPENSEFLOW_DEV_PASSWORD=\($dev_password) -e MFA_TOTP_SECRET_ENCRYPTION_KEY=\"$mfa_key\" -e AWS_REGION=\($aws_region_env) \($demo_seed_env) -e ALLOW_NON_LOOPBACK_AUTH_SEED=true \($image) \($node_command)"
    ]')

command_id=$(aws_cli ssm send-command \
    --instance-ids "$BASTION_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=$remote_commands" \
    --query 'Command.CommandId' --output text)

echo "Command dispatched: $command_id" >&2

status="Pending"
while [[ "$status" == "Pending" || "$status" == "InProgress" || "$status" == "Delayed" ]]; do
    sleep 2
    status=$(aws_cli ssm get-command-invocation \
        --command-id "$command_id" \
        --instance-id "$BASTION_INSTANCE_ID" \
        --query 'Status' --output text 2>/dev/null || echo "Pending")
done

aws_cli ssm get-command-invocation \
    --command-id "$command_id" \
    --instance-id "$BASTION_INSTANCE_ID" \
    --query 'StandardOutputContent' --output text

if [[ "$status" != "Success" ]]; then
    echo "Command finished with status $status. stderr:" >&2
    aws_cli ssm get-command-invocation \
        --command-id "$command_id" \
        --instance-id "$BASTION_INSTANCE_ID" \
        --query 'StandardErrorContent' --output text >&2
    exit 1
fi
