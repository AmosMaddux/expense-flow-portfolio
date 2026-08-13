#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
IMAGE_TAG="${IMAGE_TAG:-scrum-147-smoke}"
RENDER_DIR="${RENDER_DIR:-/tmp/expenseflow-scrum-147-task-definitions}"
VALIDATE_RENDER_ONLY="${VALIDATE_RENDER_ONLY:-false}"

CORE_CASE_REPOSITORY="${CORE_CASE_REPOSITORY:-expenseflow-core-case-service}"
GL_CODING_REPOSITORY="${GL_CODING_REPOSITORY:-expenseflow-gl-coding-service}"
CORE_CASE_LOG_GROUP="${CORE_CASE_LOG_GROUP:-/ecs/expenseflow-sandbox/core-case-service}"
GL_CODING_LOG_GROUP="${GL_CODING_LOG_GROUP:-/ecs/expenseflow-sandbox/gl-coding-service}"
EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-expenseflow-sandbox-ecs-task-execution-role}"
CORE_CASE_TASK_ROLE_NAME="${CORE_CASE_TASK_ROLE_NAME:-expenseflow-sandbox-core-case-task-role}"
GL_CODING_TASK_ROLE_NAME="${GL_CODING_TASK_ROLE_NAME:-expenseflow-sandbox-gl-coding-task-role}"
STAGE_TRANSITION_SNS_TOPIC_NAME="${STAGE_TRANSITION_SNS_TOPIC_NAME:-expenseflow-sandbox-stage-transitions}"

if [[ "$VALIDATE_RENDER_ONLY" != "true" && "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
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

sns_topic_arn() {
    local topic_name="$1"
    local topic_arn

    topic_arn="$(aws_cli sns list-topics \
        --query "Topics[?ends_with(TopicArn, ':$topic_name')].TopicArn | [0]" \
        --output text)"

    if [[ -z "$topic_arn" || "$topic_arn" == "None" ]]; then
        echo "Required SNS topic is missing or inaccessible: $topic_name" >&2
        echo "Run create-runtime-smoke-resources.sh first, or provide STAGE_TRANSITION_SNS_TOPIC_ARN explicitly." >&2
        return 1
    fi

    echo "$topic_arn"
}

require_non_loopback_endpoint() {
    local variable_name="$1"
    local endpoint_value="$2"

    if [[ -z "$endpoint_value" ]]; then
        echo "$variable_name must be supplied explicitly for ECS sandbox task registration." >&2
        return 1
    fi

    if [[ "$endpoint_value" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*://([^/@]*@)?(127\.0\.0\.1|localhost)(:|/|$) ]]; then
        echo "$variable_name must point at an ECS-reachable service endpoint, not $endpoint_value." >&2
        echo "Use Cloud Map, ECS Service Connect, or an internal load balancer DNS name for sandbox task registration." >&2
        return 1
    fi
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" ]]; then
        echo "$variable_name must be supplied explicitly for ECS sandbox task registration." >&2
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

export AWS_REGION
export AUTH_JWT_KEY_ID="${AUTH_JWT_KEY_ID:-synthetic-scrum-147-key}"
export MFA_TOTP_SECRET_KEY_VERSION="${MFA_TOTP_SECRET_KEY_VERSION:-scrum-147-synthetic-v1}"
export CORE_CASE_INTERNAL_ROUTES_ENABLED="${CORE_CASE_INTERNAL_ROUTES_ENABLED:-false}"
export RUNTIME_SMOKE_GL_CODING_ENABLED="${RUNTIME_SMOKE_GL_CODING_ENABLED:-false}"
export SPA_ORIGIN="${SPA_ORIGIN:-}"
export GL_CODING_SERVICE_BASE_URL="${GL_CODING_SERVICE_BASE_URL:-}"
export DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-sandbox-expense-report}"
export DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX:-expenseflow-sandbox-expense-report-tenant-index}"
export RECEIPT_STORAGE_BUCKET="${RECEIPT_STORAGE_BUCKET:-expenseflow-sandbox-receipts}"
export REDIS_URL="${REDIS_URL:-}"
export TIN_EIN_VALIDATION_ENDPOINT_URL="${TIN_EIN_VALIDATION_ENDPOINT_URL:-https://tin-ein-validation.example.test/soap}"
export TIN_EIN_VALIDATION_WSDL_URL="${TIN_EIN_VALIDATION_WSDL_URL:-https://tin-ein-validation.example.test/service.wsdl}"

require_non_loopback_endpoint GL_CODING_SERVICE_BASE_URL "$GL_CODING_SERVICE_BASE_URL"
require_non_loopback_endpoint REDIS_URL "$REDIS_URL"
require_non_loopback_endpoint CORE_CASE_DATABASE_URL "${CORE_CASE_DATABASE_URL:-}"
require_non_loopback_endpoint GL_CODING_DATABASE_URL "${GL_CODING_DATABASE_URL:-}"
require_non_empty SPA_ORIGIN "$SPA_ORIGIN"

if [[ "$VALIDATE_RENDER_ONLY" == "true" ]]; then
    require_non_empty STAGE_TRANSITION_SNS_TOPIC_ARN "${STAGE_TRANSITION_SNS_TOPIC_ARN:-}"
    account_id="000000000000"
    registry_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"
    CORE_CASE_TASK_ROLE_ARN="${CORE_CASE_TASK_ROLE_ARN:-synthetic-core-case-task-role-ref}"
    ECS_TASK_EXECUTION_ROLE_ARN="${ECS_TASK_EXECUTION_ROLE_ARN:-synthetic-execution-role-ref}"
    GL_CODING_TASK_ROLE_ARN="${GL_CODING_TASK_ROLE_ARN:-synthetic-gl-coding-task-role-ref}"
    CORE_CASE_DATABASE_URL_SECRET_ARN="${CORE_CASE_DATABASE_URL_SECRET_ARN:-synthetic-core-case-db-secret-ref}"
    CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN="${CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN:-synthetic-core-case-private-key-secret-ref}"
    CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN="${CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN:-synthetic-core-case-mfa-key-secret-ref}"
    CORE_CASE_RUNTIME_SMOKE_SHARED_SECRET_ARN="${CORE_CASE_RUNTIME_SMOKE_SHARED_SECRET_ARN:-synthetic-core-case-runtime-smoke-secret-ref}"
    CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN="${CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN:-synthetic-tin-user-secret-ref}"
    CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN="${CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN:-synthetic-tin-password-secret-ref}"
    GL_CODING_DATABASE_URL_SECRET_ARN="${GL_CODING_DATABASE_URL_SECRET_ARN:-synthetic-gl-coding-db-secret-ref}"
    GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN="${GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN:-synthetic-gl-public-keys-secret-ref}"
    export CORE_CASE_DATABASE_URL_SECRET_ARN
    export CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN
    export CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN
    export CORE_CASE_RUNTIME_SMOKE_SHARED_SECRET_ARN
    export CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN
    export CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN
    export GL_CODING_DATABASE_URL_SECRET_ARN
    export GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN
else
    account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
    registry_uri="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"
    export STAGE_TRANSITION_SNS_TOPIC_ARN="${STAGE_TRANSITION_SNS_TOPIC_ARN:-$(sns_topic_arn "$STAGE_TRANSITION_SNS_TOPIC_NAME")}"
fi

export STAGE_TRANSITION_SNS_TOPIC_ARN

export CORE_CASE_IMAGE_URI="${CORE_CASE_IMAGE_URI:-$registry_uri/$CORE_CASE_REPOSITORY:$IMAGE_TAG}"
export GL_CODING_IMAGE_URI="${GL_CODING_IMAGE_URI:-$registry_uri/$GL_CODING_REPOSITORY:$IMAGE_TAG}"
if [[ "$VALIDATE_RENDER_ONLY" != "true" ]]; then
    ECS_TASK_EXECUTION_ROLE_ARN="${ECS_TASK_EXECUTION_ROLE_ARN:-$(iam_role_arn "$EXECUTION_ROLE_NAME")}"
    CORE_CASE_TASK_ROLE_ARN="${CORE_CASE_TASK_ROLE_ARN:-$(iam_role_arn "$CORE_CASE_TASK_ROLE_NAME")}"
    GL_CODING_TASK_ROLE_ARN="${GL_CODING_TASK_ROLE_ARN:-$(iam_role_arn "$GL_CODING_TASK_ROLE_NAME")}"
fi
export ECS_TASK_EXECUTION_ROLE_ARN
export CORE_CASE_TASK_ROLE_ARN
export GL_CODING_TASK_ROLE_ARN
export CORE_CASE_LOG_GROUP_NAME="$CORE_CASE_LOG_GROUP"
export GL_CODING_LOG_GROUP_NAME="$GL_CODING_LOG_GROUP"
if [[ "$VALIDATE_RENDER_ONLY" != "true" ]]; then
    export CORE_CASE_DATABASE_URL_SECRET_ARN="${CORE_CASE_DATABASE_URL_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/database-url)}"
    export CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN="${CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/auth-jwt-private-key-base64)}"
    export CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN="${CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key)}"
    export CORE_CASE_RUNTIME_SMOKE_SHARED_SECRET_ARN="${CORE_CASE_RUNTIME_SMOKE_SHARED_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/runtime-smoke-shared-secret)}"
    export CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN="${CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/tin-ein-validation-username)}"
    export CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN="${CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN:-$(secret_arn expenseflow/sandbox/core-case/tin-ein-validation-password)}"
    export GL_CODING_DATABASE_URL_SECRET_ARN="${GL_CODING_DATABASE_URL_SECRET_ARN:-$(secret_arn expenseflow/sandbox/gl-coding/database-url)}"
    export GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN="${GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN:-$(secret_arn expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json)}"
fi

core_case_rendered="$RENDER_DIR/core-case-service.task-definition.json"
gl_coding_rendered="$RENDER_DIR/gl-coding-service.task-definition.json"

render_template infra/ecs/task-definitions/core-case-service.task-definition.json "$core_case_rendered"
render_template infra/ecs/task-definitions/gl-coding-service.task-definition.json "$gl_coding_rendered"

if [[ "$VALIDATE_RENDER_ONLY" == "true" ]]; then
    echo "Validated rendered task definitions in $RENDER_DIR"
    exit 0
fi

aws_cli ecs register-task-definition \
    --cli-input-json "file://$core_case_rendered" \
    --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147

aws_cli ecs register-task-definition \
    --cli-input-json "file://$gl_coding_rendered" \
    --tags key=user,value=amos-maddux key=env,value=sandbox key=ticket,value=SCRUM-147

echo "Registered task definitions from rendered files in $RENDER_DIR"
