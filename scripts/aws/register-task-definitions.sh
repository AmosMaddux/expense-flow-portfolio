#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
IMAGE_TAG="${IMAGE_TAG:-scrum-147-smoke}"
RENDER_DIR="${RENDER_DIR:-/tmp/expenseflow-scrum-147-task-definitions}"

CORE_CASE_REPOSITORY="${CORE_CASE_REPOSITORY:-expenseflow-core-case-service}"
GL_CODING_REPOSITORY="${GL_CODING_REPOSITORY:-expenseflow-gl-coding-service}"
CORE_CASE_LOG_GROUP="${CORE_CASE_LOG_GROUP:-/ecs/expenseflow-sandbox/core-case-service}"
GL_CODING_LOG_GROUP="${GL_CODING_LOG_GROUP:-/ecs/expenseflow-sandbox/gl-coding-service}"
EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-expenseflow-sandbox-ecs-task-execution-role}"
CORE_CASE_TASK_ROLE_NAME="${CORE_CASE_TASK_ROLE_NAME:-expenseflow-sandbox-core-case-task-role}"
GL_CODING_TASK_ROLE_NAME="${GL_CODING_TASK_ROLE_NAME:-expenseflow-sandbox-gl-coding-task-role}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

secret_arn() {
    aws_cli secretsmanager describe-secret --secret-id "$1" --query ARN --output text
}

iam_role_arn() {
    local role_name="$1"

    if ! aws_cli iam get-role --role-name "$role_name" --query 'Role.Arn' --output text; then
        echo "Required IAM role is missing or inaccessible: $role_name" >&2
        echo "Run create-runtime-smoke-resources.sh with IAM role permissions, or provide the corresponding *_ROLE_ARN override." >&2
        return 1
    fi
}

render_template() {
    local source_file="$1"
    local target_file="$2"

    TEMPLATE_SOURCE="$source_file" TEMPLATE_TARGET="$target_file" node -e "
const fs = require('fs');
const source = process.env.TEMPLATE_SOURCE;
const target = process.env.TEMPLATE_TARGET;
const values = process.env;
let rendered = fs.readFileSync(source, 'utf8');
for (const [key, value] of Object.entries(values)) {
  rendered = rendered.replaceAll('\${' + key + '}', value);
}
const unresolved = rendered.match(/\$\{[A-Z0-9_]+\}/g);
if (unresolved) {
  throw new Error('Unresolved task definition placeholders: ' + [...new Set(unresolved)].join(', '));
}
JSON.parse(rendered);
fs.mkdirSync(require('path').dirname(target), { recursive: true });
fs.writeFileSync(target, rendered);
"
}

account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
registry_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"

export AWS_REGION
export AUTH_JWT_KEY_ID="${AUTH_JWT_KEY_ID:-synthetic-scrum-147-key}"
export MFA_TOTP_SECRET_KEY_VERSION="${MFA_TOTP_SECRET_KEY_VERSION:-scrum-147-synthetic-v1}"
export GL_CODING_SERVICE_BASE_URL="${GL_CODING_SERVICE_BASE_URL:-http://127.0.0.1:8001}"
export DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-sandbox-expense-report}"
export DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX:-expenseflow-sandbox-expense-report-tenant-index}"
export RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export STAGE_TRANSITION_SNS_TOPIC_ARN="${STAGE_TRANSITION_SNS_TOPIC_ARN:-arn:aws:sns:$AWS_REGION:$account_id:expenseflow-sandbox-stage-transitions}"
export TIN_EIN_VALIDATION_ENDPOINT_URL="${TIN_EIN_VALIDATION_ENDPOINT_URL:-https://tin-ein-validation.example.test/soap}"
export TIN_EIN_VALIDATION_WSDL_URL="${TIN_EIN_VALIDATION_WSDL_URL:-https://tin-ein-validation.example.test/service.wsdl}"

export CORE_CASE_IMAGE_URI="${CORE_CASE_IMAGE_URI:-$registry_uri/$CORE_CASE_REPOSITORY:$IMAGE_TAG}"
export GL_CODING_IMAGE_URI="${GL_CODING_IMAGE_URI:-$registry_uri/$GL_CODING_REPOSITORY:$IMAGE_TAG}"
ECS_TASK_EXECUTION_ROLE_ARN="${ECS_TASK_EXECUTION_ROLE_ARN:-$(iam_role_arn "$EXECUTION_ROLE_NAME")}"
CORE_CASE_TASK_ROLE_ARN="${CORE_CASE_TASK_ROLE_ARN:-$(iam_role_arn "$CORE_CASE_TASK_ROLE_NAME")}"
GL_CODING_TASK_ROLE_ARN="${GL_CODING_TASK_ROLE_ARN:-$(iam_role_arn "$GL_CODING_TASK_ROLE_NAME")}"
export ECS_TASK_EXECUTION_ROLE_ARN
export CORE_CASE_TASK_ROLE_ARN
export GL_CODING_TASK_ROLE_ARN
export CORE_CASE_LOG_GROUP_NAME="$CORE_CASE_LOG_GROUP"
export GL_CODING_LOG_GROUP_NAME="$GL_CODING_LOG_GROUP"
export CORE_CASE_DATABASE_URL_SECRET_ARN="${CORE_CASE_DATABASE_URL_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/database-url)}"
export CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN="${CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/auth-jwt-private-key-base64)}"
export CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN="${CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key)}"
export CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN="${CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/tin-ein-validation-username)}"
export CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN="${CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/tin-ein-validation-password)}"
export GL_CODING_DATABASE_URL_SECRET_ARN="${GL_CODING_DATABASE_URL_SECRET_ARN:-$(secret_arn expenseflow/sandbox/gl-coding/database-url)}"
export GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN="${GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN:-$(secret_arn expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json)}"

core_case_rendered="$RENDER_DIR/core-case-service.task-definition.json"
gl_coding_rendered="$RENDER_DIR/gl-coding-service.task-definition.json"

render_template infra/ecs/task-definitions/core-case-service.task-definition.json "$core_case_rendered"
render_template infra/ecs/task-definitions/gl-coding-service.task-definition.json "$gl_coding_rendered"

aws_cli ecs register-task-definition \
    --cli-input-json "file://$core_case_rendered" \
    --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147

aws_cli ecs register-task-definition \
    --cli-input-json "file://$gl_coding_rendered" \
    --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147

echo "Registered task definitions from rendered files in $RENDER_DIR"
