#!/usr/bin/env bash
set -euo pipefail
umask 077

# Prepares only the runtime-smoke Terraform prerequisites needed by
# run-deployed-smoke.sh. Intended for a human operator to run when the deployed
# Core Case task definition does not yet include the runtime-smoke secret/flag.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/terraform/environments/sandbox}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"
PREP_DB_TUNNEL_LOCAL_PORT="${PREP_DB_TUNNEL_LOCAL_PORT:-15432}"

RUNTIME_SMOKE_SECRET_NAME="${RUNTIME_SMOKE_SECRET_NAME:-expenseflow/sandbox/core-case/runtime-smoke-shared-secret}"
SECRET_OWNER_TAG="${SECRET_OWNER_TAG:-amos-maddux}"
SECRET_TICKET_TAG="${SECRET_TICKET_TAG:-SCRUM-160}"
EXISTING_RUNTIME_SMOKE_SECRET_ARN="${EXISTING_RUNTIME_SMOKE_SECRET_ARN:-}"
PREP_DB_TUNNEL_LOG=""
PREP_DB_TUNNEL_PID=""

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

require_tool() {
    local tool="$1"

    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is required. Install it before running this script." >&2
        exit 1
    fi
}

for tool in aws terraform jq curl openssl node session-manager-plugin nc; do
    require_tool "$tool"
done

if [[ ! -d "$TERRAFORM_DIR" || ! -f "scripts/aws/e2e/run-deployed-smoke.sh" ]]; then
    echo "Run this script from the repository root." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

terraform_outputs_json() {
    terraform -chdir="$TERRAFORM_DIR" output -json
}

tf_output() {
    local key="$1"
    local value

    value="$(TF_OUTPUTS_JSON="$TF_OUTPUTS_JSON" KEY="$key" node --input-type=module -e '
const outputs = JSON.parse(process.env.TF_OUTPUTS_JSON ?? "{}");
const key = process.env.KEY;
if (key === undefined || !(key in outputs)) {
  process.exit(1);
}
const value = outputs[key].value;
process.stdout.write(Array.isArray(value) ? value.join(",") : String(value));
')" || {
        echo "Terraform output $key is missing. Apply $TERRAFORM_DIR first." >&2
        exit 1
    }

    if [[ -z "$value" || "$value" == "None" ]]; then
        echo "Terraform output $key is empty. Apply $TERRAFORM_DIR first." >&2
        exit 1
    fi

    echo "$value"
}

container_env_value() {
    local container_json="$1"
    local name="$2"

    jq -r --arg name "$name" '.environment[]? | select(.name == $name) | .value' <<<"$container_json" | tail -1
}

container_secret_value_from() {
    local container_json="$1"
    local name="$2"

    jq -r --arg name "$name" '.secrets[]? | select(.name == $name) | .valueFrom' <<<"$container_json" | tail -1
}

require_non_empty() {
    local variable_name="$1"
    local variable_value="$2"

    if [[ -z "$variable_value" || "$variable_value" == "None" || "$variable_value" == "null" ]]; then
        echo "$variable_name could not be resolved automatically." >&2
        return 1
    fi
}

current_service_task_definition_arn() {
    local cluster_name="$1"
    local service_name="$2"

    aws_cli ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --query 'services[0].taskDefinition' \
        --output text
}

task_container_json() {
    local task_definition_arn="$1"
    local container_name="$2"

    aws_cli ecs describe-task-definition \
        --task-definition "$task_definition_arn" \
        --query "taskDefinition.containerDefinitions[?name=='$container_name'] | [0]" \
        --output json
}

load_balancer_arn() {
    aws_cli elbv2 describe-load-balancers \
        --names "$1" \
        --query 'LoadBalancers[0].LoadBalancerArn' \
        --output text
}

listener_arn_for_port() {
    local alb_arn="$1"
    local port="$2"

    aws_cli elbv2 describe-listeners \
        --load-balancer-arn "$alb_arn" \
        --query "Listeners[?Port==\`$port\`].ListenerArn | [0]" \
        --output text
}

listener_exists() {
    local listener_arn="$1"

    [[ -n "$listener_arn" && "$listener_arn" != "None" ]]
}

https_certificate_arn() {
    local https_listener_arn="$1"

    aws_cli elbv2 describe-listeners \
        --listener-arns "$https_listener_arn" \
        --query 'Listeners[0].Certificates[0].CertificateArn' \
        --output text
}

runtime_smoke_secret_arn() {
    local existing_arn

    if [[ -n "$EXISTING_RUNTIME_SMOKE_SECRET_ARN" && "$EXISTING_RUNTIME_SMOKE_SECRET_ARN" != "None" ]]; then
        echo "$EXISTING_RUNTIME_SMOKE_SECRET_ARN"
        return 0
    fi

    existing_arn="$(aws_cli secretsmanager describe-secret \
        --secret-id "$RUNTIME_SMOKE_SECRET_NAME" \
        --query ARN \
        --output text 2>/dev/null || true)"

    if [[ -n "$existing_arn" && "$existing_arn" != "None" ]]; then
        aws_cli secretsmanager tag-resource \
            --secret-id "$RUNTIME_SMOKE_SECRET_NAME" \
            --tags Key=user,Value="$SECRET_OWNER_TAG" Key=env,Value=sandbox Key=ticket,Value="$SECRET_TICKET_TAG" >/dev/null
        echo "$existing_arn"
        return 0
    fi

    aws_cli secretsmanager create-secret \
        --name "$RUNTIME_SMOKE_SECRET_NAME" \
        --description "Demo-grade Core Case runtime-smoke shared secret." \
        --secret-string "$(openssl rand -base64 32)" \
        --tags Key=user,Value="$SECRET_OWNER_TAG" Key=env,Value=sandbox Key=ticket,Value="$SECRET_TICKET_TAG" \
        --query ARN \
        --output text
}

caller_public_cidr() {
    local ip_address

    ip_address="$(curl --fail --silent --show-error https://checkip.amazonaws.com | tr -d '[:space:]')"
    if [[ ! "$ip_address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Unable to resolve caller public IPv4 address from checkip.amazonaws.com." >&2
        exit 1
    fi

    echo "$ip_address/32"
}

optional_var() {
    local name="$1"
    local value="$2"

    if [[ -n "$value" && "$value" != "None" ]]; then
        terraform_vars+=("-var=$name=$value")
    fi
}

open_database_tunnel() {
    local bastion_instance_id="$1"
    local database_host="$2"

    if nc -z localhost "$PREP_DB_TUNNEL_LOCAL_PORT" 2>/dev/null; then
        echo "Local port $PREP_DB_TUNNEL_LOCAL_PORT is already in use. Set PREP_DB_TUNNEL_LOCAL_PORT to a free port." >&2
        exit 1
    fi

    PREP_DB_TUNNEL_LOG="$(mktemp)"
    set -m
    aws_cli ssm start-session \
        --target "$bastion_instance_id" \
        --document-name AWS-StartPortForwardingSessionToRemoteHost \
        --parameters "{\"host\":[\"$database_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$PREP_DB_TUNNEL_LOCAL_PORT\"]}" \
        >"$PREP_DB_TUNNEL_LOG" 2>&1 &
    PREP_DB_TUNNEL_PID=$!
    set +m

    cleanup_database_tunnel() {
        if [[ -n "${PREP_DB_TUNNEL_PID:-}" ]]; then
            kill -- "-$PREP_DB_TUNNEL_PID" 2>/dev/null || true
            wait "$PREP_DB_TUNNEL_PID" 2>/dev/null || true
        fi
        if [[ -n "${PREP_DB_TUNNEL_LOG:-}" ]]; then
            rm -f "$PREP_DB_TUNNEL_LOG"
        fi
    }
    trap cleanup_database_tunnel EXIT

    local waited=0
    until nc -z localhost "$PREP_DB_TUNNEL_LOCAL_PORT" 2>/dev/null; do
        if ! kill -0 "$PREP_DB_TUNNEL_PID" 2>/dev/null; then
            echo "Bastion SSM database tunnel exited before it started listening:" >&2
            cat "$PREP_DB_TUNNEL_LOG" >&2
            exit 1
        fi
        if (( waited >= 30 )); then
            echo "Timed out waiting for the bastion SSM database tunnel on localhost:$PREP_DB_TUNNEL_LOCAL_PORT." >&2
            exit 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
}

read_rds_master_credentials() {
    local secret_arn="$1"

    aws_cli secretsmanager get-secret-value \
        --secret-id "$secret_arn" \
        --query SecretString \
        --output text
}

echo "Reading Terraform outputs from $TERRAFORM_DIR..."
TF_OUTPUTS_JSON="$(terraform_outputs_json)"

ecs_cluster_name="$(tf_output ecs_cluster_name)"
core_case_service_name="$(tf_output core_case_service_name)"
gl_coding_service_name="$(tf_output gl_coding_service_name)"
public_alb_name="$(tf_output public_alb_name)"
vpc_id="$(tf_output vpc_id)"
stage_transition_function_name="$(tf_output stage_transition_consumer_lambda_function_name)"
bastion_instance_id="$(tf_output bastion_instance_id)"
core_case_db_endpoint="$(tf_output core_case_db_endpoint)"
core_case_db_master_user_secret_arn="$(tf_output core_case_db_master_user_secret_arn)"
core_case_db_host="${core_case_db_endpoint%%:*}"

core_case_task_definition_arn="$(current_service_task_definition_arn "$ecs_cluster_name" "$core_case_service_name")"
gl_coding_task_definition_arn="$(current_service_task_definition_arn "$ecs_cluster_name" "$gl_coding_service_name")"
require_non_empty CORE_CASE_TASK_DEFINITION "$core_case_task_definition_arn"
require_non_empty GL_CODING_TASK_DEFINITION "$gl_coding_task_definition_arn"

core_case_container_json="$(task_container_json "$core_case_task_definition_arn" core-case-service)"
gl_coding_container_json="$(task_container_json "$gl_coding_task_definition_arn" gl-coding-service)"

auth_jwt_issuer="$(container_env_value "$core_case_container_json" AUTH_JWT_ISSUER)"
auth_jwt_key_id="$(container_env_value "$core_case_container_json" AUTH_JWT_KEY_ID)"
core_case_internal_routes_enabled="$(container_env_value "$core_case_container_json" CORE_CASE_INTERNAL_ROUTES_ENABLED)"
core_case_image_uri="$(jq -r '.image' <<<"$core_case_container_json")"
gl_coding_image_uri="$(jq -r '.image' <<<"$gl_coding_container_json")"
stage_transition_lambda_image_uri="$(aws_cli lambda get-function \
    --function-name "$stage_transition_function_name" \
    --query 'Code.ImageUri' \
    --output text)"

core_case_auth_jwt_private_key_secret_arn="$(container_secret_value_from "$core_case_container_json" AUTH_JWT_PRIVATE_KEY_BASE64)"
core_case_mfa_totp_secret_encryption_key_secret_arn="$(container_secret_value_from "$core_case_container_json" MFA_TOTP_SECRET_ENCRYPTION_KEY)"
core_case_internal_command_token_secret_arn="$(container_secret_value_from "$core_case_container_json" CORE_CASE_INTERNAL_COMMAND_TOKEN)"
EXISTING_RUNTIME_SMOKE_SECRET_ARN="$(container_secret_value_from "$core_case_container_json" RUNTIME_SMOKE_SHARED_SECRET)"
gl_coding_auth_jwt_public_keys_json_secret_arn="$(container_secret_value_from "$gl_coding_container_json" AUTH_JWT_JWKS_JSON)"
gl_coding_internal_auth_secret_arn="$(container_secret_value_from "$core_case_container_json" GL_CODING_INTERNAL_AUTH_SECRET)"

for resolved in \
    auth_jwt_issuer \
    auth_jwt_key_id \
    core_case_image_uri \
    gl_coding_image_uri \
    stage_transition_lambda_image_uri \
    core_case_auth_jwt_private_key_secret_arn \
    core_case_mfa_totp_secret_encryption_key_secret_arn \
    core_case_internal_command_token_secret_arn \
    gl_coding_auth_jwt_public_keys_json_secret_arn; do
    require_non_empty "$resolved" "${!resolved}"
done

runtime_smoke_secret_arn="$(runtime_smoke_secret_arn)"
caller_cidr="$(caller_public_cidr)"
account_id="$(aws_cli sts get-caller-identity --query Account --output text)"
role_permissions_boundary_arn="${ROLE_PERMISSIONS_BOUNDARY_ARN:-arn:aws:iam::$account_id:policy/TraineeSandboxBoundary}"

public_alb_arn="$(load_balancer_arn "$public_alb_name")"
https_listener_arn="$(listener_arn_for_port "$public_alb_arn" 443)"

terraform_vars=(
    "-var=http_api_jwt_issuer=$auth_jwt_issuer"
    "-var=auth_jwt_key_id=$auth_jwt_key_id"
    "-var=core_case_internal_command_token_secret_arn=$core_case_internal_command_token_secret_arn"
    "-var=core_case_auth_jwt_private_key_secret_arn=$core_case_auth_jwt_private_key_secret_arn"
    "-var=gl_coding_auth_jwt_public_keys_json_secret_arn=$gl_coding_auth_jwt_public_keys_json_secret_arn"
    "-var=core_case_mfa_totp_secret_encryption_key_secret_arn=$core_case_mfa_totp_secret_encryption_key_secret_arn"
    "-var=core_case_runtime_smoke_shared_secret_arn=$runtime_smoke_secret_arn"
    "-var=runtime_smoke_gl_coding_enabled=true"
    "-var=runtime_smoke_source_cidrs=[\"$caller_cidr\"]"
    "-var=role_permissions_boundary_arn=$role_permissions_boundary_arn"
    "-var=enable_nat_gateway=false"
    "-var=db_enable_enhanced_monitoring=false"
    "-var=core_case_internal_routes_enabled=${core_case_internal_routes_enabled:-true}"
    "-var=http_api_lambda_vpc_id=$vpc_id"
    "-var=core_case_image_uri=$core_case_image_uri"
    "-var=gl_coding_image_uri=$gl_coding_image_uri"
    "-var=stage_transition_lambda_image_uri=$stage_transition_lambda_image_uri"
    "-var=postgresql_provider_host=localhost"
    "-var=postgresql_provider_port=$PREP_DB_TUNNEL_LOCAL_PORT"
    "-var=db_readonly_roles_and_extensions_enabled=true"
)

if listener_exists "$https_listener_arn"; then
    public_alb_certificate_arn="$(https_certificate_arn "$https_listener_arn")"
    optional_var public_alb_certificate_arn "$public_alb_certificate_arn"
else
    terraform_vars+=("-var=allow_plain_http_public_api=true")
fi

optional_var gl_coding_internal_auth_secret_arn "$gl_coding_internal_auth_secret_arn"

apply_args=(-input=false)
if [[ "$AUTO_APPROVE" == "true" ]]; then
    apply_args+=(-auto-approve)
fi

echo "Applying runtime-smoke prerequisites for caller CIDR $caller_cidr..."
open_database_tunnel "$bastion_instance_id" "$core_case_db_host"
rds_master_credentials="$(read_rds_master_credentials "$core_case_db_master_user_secret_arn")"
pg_user="$(jq -r .username <<<"$rds_master_credentials")"
pg_password="$(jq -r .password <<<"$rds_master_credentials")"
unset rds_master_credentials
require_non_empty PGUSER "$pg_user"
require_non_empty PGPASSWORD "$pg_password"

PGUSER="$pg_user" PGPASSWORD="$pg_password" \
    terraform -chdir="$TERRAFORM_DIR" apply "${apply_args[@]}" "${terraform_vars[@]}"
unset pg_password

echo
echo "Runtime-smoke prerequisites are ready."
echo "Run the smoke suite with:"
echo
echo "  AWS_PROFILE=$AWS_PROFILE scripts/aws/e2e/run-deployed-smoke.sh"
