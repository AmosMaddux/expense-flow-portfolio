#!/usr/bin/env bash
set -euo pipefail

# Publishes the local Policy Assist/OpenAI API key to AWS Secrets Manager for
# the Terraform-managed sandbox. The secret value is never printed; the script
# emits only the resulting ARN and the Terraform -var line.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
SECRET_NAME="${SECRET_NAME:-expenseflow/sandbox/core-case/policy-assist-api-key}"
SECRET_TICKET_TAG="${SECRET_TICKET_TAG:-AI-Implementation}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env"
    set +a
fi

POLICY_ASSIST_SECRET_VALUE="${POLICY_ASSIST_API_KEY:-${OPENAI_API_KEY:-}}"
if [[ -z "$POLICY_ASSIST_SECRET_VALUE" ]]; then
    echo "POLICY_ASSIST_API_KEY or OPENAI_API_KEY must be set in the environment or .env." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

caller_arn="$(aws_cli sts get-caller-identity --query Arn --output text)"
caller_name="$(sed -E 's#.*(user|assumed-role)/([^/@]+).*#\2#' <<<"$caller_arn")"
SECRET_OWNER_TAG="${SECRET_OWNER_TAG:-$caller_name}"
TAGS=(Key=user,Value="$SECRET_OWNER_TAG" Key=env,Value=sandbox Key=ticket,Value="$SECRET_TICKET_TAG")

secret_file="$(mktemp)"
trap 'rm -f "$secret_file"' EXIT
chmod 600 "$secret_file"

POLICY_ASSIST_SECRET_VALUE="$POLICY_ASSIST_SECRET_VALUE" node --input-type=module >"$secret_file" <<'NODE'
const apiKey = process.env.POLICY_ASSIST_SECRET_VALUE;
if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Policy Assist API key is required.");
}

process.stdout.write(JSON.stringify({ POLICY_ASSIST_API_KEY: apiKey }));
NODE

if secret_arn="$(aws_cli secretsmanager describe-secret --secret-id "$SECRET_NAME" --query ARN --output text 2>/dev/null)"; then
    aws_cli secretsmanager put-secret-value \
        --secret-id "$SECRET_NAME" \
        --secret-string "file://$secret_file" >/dev/null
else
    secret_arn="$(aws_cli secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "OpenAI API key used by ExpenseFlow sandbox Core Case policy assist." \
        --secret-string "file://$secret_file" \
        --tags "${TAGS[@]}" \
        --query ARN \
        --output text)"
fi

aws_cli secretsmanager tag-resource --secret-id "$SECRET_NAME" --tags "${TAGS[@]}"

echo "Published Policy Assist secret:"
echo
echo "  $secret_arn"
echo
echo "Pass this to Terraform:"
echo
echo "  -var core_case_policy_assist_api_key_secret_arn=$secret_arn"
