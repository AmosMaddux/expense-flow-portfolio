#!/usr/bin/env bash
set -euo pipefail

# Generates the demo-grade Secrets Manager secrets required by the
# Terraform-managed sandbox (infra/terraform/environments/sandbox) that have
# no default and no existing creation path:
#
#   1. Core Case JWT signing keypair (private half)
#   2. GL-coding JWT public JWKS (public half of the same keypair)
#   3. Core Case MFA TOTP encryption key
#   4. Core Case runtime-smoke shared secret (optional, RUNTIME_SMOKE_GL_CODING_ENABLED=true)
#   5. Core Case internal command token (shared with the Issue Payment Lambda)
#
# This does not create infrastructure and is idempotent: re-running rotates
# secret values in place rather than failing on already-exists. Print the
# resulting ARNs and pass them as -var flags on `terraform apply` (see the
# script's final output).
#
# AUTH_JWT_KEY_ID must match the sandbox root's auth_jwt_key_id variable
# (default: synthetic-sandbox-key). Core Case signs JWTs with this as the
# `kid` header; GL-coding matches JWKS entries by the same `kid`. If you
# override auth_jwt_key_id on terraform apply, pass the same value here.

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

AUTH_JWT_KEY_ID="${AUTH_JWT_KEY_ID:-synthetic-sandbox-key}"
INCLUDE_RUNTIME_SMOKE_SECRET="${INCLUDE_RUNTIME_SMOKE_SECRET:-false}"
SECRET_OWNER_TAG="${SECRET_OWNER_TAG:-amos-maddux}"
SECRET_TICKET_TAG="${SECRET_TICKET_TAG:-SCRUM-156}"

TAGS=(Key=user,Value="$SECRET_OWNER_TAG" Key=env,Value=sandbox Key=ticket,Value="$SECRET_TICKET_TAG")

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

put_secret() {
    local secret_name="$1"
    local secret_value="$2"
    local description="$3"
    local secret_arn

    if secret_arn="$(aws_cli secretsmanager describe-secret --secret-id "$secret_name" --query ARN --output text 2>/dev/null)"; then
        aws_cli secretsmanager put-secret-value --secret-id "$secret_name" --secret-string "$secret_value" >/dev/null
    else
        secret_arn="$(aws_cli secretsmanager create-secret \
            --name "$secret_name" \
            --description "$description" \
            --secret-string "$secret_value" \
            --tags "${TAGS[@]}" \
            --query ARN \
            --output text)"
    fi

    aws_cli secretsmanager tag-resource --secret-id "$secret_name" --tags "${TAGS[@]}"
    echo "$secret_arn"
}

generate_jwt_key_material() {
    local temp_dir private_key_file public_key_file
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"; trap - RETURN EXIT' RETURN EXIT
    private_key_file="$temp_dir/private.pem"
    public_key_file="$temp_dir/public.pem"

    openssl genpkey \
        -algorithm RSA \
        -pkeyopt rsa_keygen_bits:2048 \
        -out "$private_key_file" >/dev/null 2>&1
    openssl rsa \
        -in "$private_key_file" \
        -pubout \
        -out "$public_key_file" >/dev/null 2>&1

    JWT_PRIVATE_KEY_BASE64="$(base64 -w 0 "$private_key_file")"
    JWT_PUBLIC_KEYS_JSON="$(
        AUTH_JWT_KEY_ID="$AUTH_JWT_KEY_ID" PUBLIC_KEY_FILE="$public_key_file" node --input-type=module <<'NODE'
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

const keyId = process.env.AUTH_JWT_KEY_ID;
const publicKeyFile = process.env.PUBLIC_KEY_FILE;
if (keyId === undefined || publicKeyFile === undefined) {
    throw new Error("JWT key ID and public key file are required.");
}

const jwk = createPublicKey(readFileSync(publicKeyFile, "utf8")).export({
    format: "jwk",
});
process.stdout.write(
    JSON.stringify({
        keys: [
            {
                kty: "RSA",
                kid: keyId,
                use: "sig",
                alg: "RS256",
                n: jwk.n,
                e: jwk.e,
            },
        ],
    }),
);
NODE
    )"
}

main() {
    echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    aws_cli sts get-caller-identity >/dev/null

    echo "Generating RSA-2048 JWT keypair (key ID: $AUTH_JWT_KEY_ID)..."
    generate_jwt_key_material

    echo "Publishing Core Case JWT private key secret..."
    core_case_auth_jwt_private_key_secret_arn="$(put_secret \
        expenseflow/sandbox/core-case/auth-jwt-private-key-base64 \
        "$JWT_PRIVATE_KEY_BASE64" \
        "Demo-grade Core Case JWT signing private key (SCRUM-156).")"

    echo "Publishing GL-coding JWT public JWKS secret..."
    gl_coding_auth_jwt_public_keys_json_secret_arn="$(put_secret \
        expenseflow/sandbox/gl-coding/auth-jwt-public-keys-json \
        "$JWT_PUBLIC_KEYS_JSON" \
        "Demo-grade GL-coding JWT public JWKS, public half of the Core Case signing key (SCRUM-156).")"

    echo "Publishing Core Case MFA TOTP encryption key secret..."
    core_case_mfa_totp_secret_encryption_key_secret_arn="$(put_secret \
        expenseflow/sandbox/core-case/mfa-totp-secret-encryption-key \
        "$(openssl rand -base64 32)" \
        "Demo-grade Core Case MFA TOTP secret encryption key (SCRUM-156).")"

    echo "Publishing Core Case internal command token secret..."
    core_case_internal_command_token_secret_arn="$(put_secret \
        expenseflow/sandbox/core-case/internal-command-token \
        "$(openssl rand -base64 32)" \
        "Demo-grade shared token between Core Case and the Issue Payment Lambda (SCRUM-156).")"

    core_case_runtime_smoke_shared_secret_arn=""
    if [[ "$INCLUDE_RUNTIME_SMOKE_SECRET" == "true" ]]; then
        echo "Publishing Core Case runtime-smoke shared secret..."
        core_case_runtime_smoke_shared_secret_arn="$(put_secret \
            expenseflow/sandbox/core-case/runtime-smoke-shared-secret \
            "$(openssl rand -base64 32)" \
            "Demo-grade Core Case runtime-smoke shared secret (SCRUM-156).")"
    else
        echo "Skipping runtime-smoke shared secret (set INCLUDE_RUNTIME_SMOKE_SECRET=true to include it)."
    fi

    echo
    echo "Done. Pass these as -var flags on terraform apply (auth_jwt_key_id must equal $AUTH_JWT_KEY_ID, its default):"
    echo
    echo "  -var core_case_auth_jwt_private_key_secret_arn=$core_case_auth_jwt_private_key_secret_arn"
    echo "  -var gl_coding_auth_jwt_public_keys_json_secret_arn=$gl_coding_auth_jwt_public_keys_json_secret_arn"
    echo "  -var core_case_mfa_totp_secret_encryption_key_secret_arn=$core_case_mfa_totp_secret_encryption_key_secret_arn"
    echo "  -var core_case_internal_command_token_secret_arn=$core_case_internal_command_token_secret_arn"
    if [[ -n "$core_case_runtime_smoke_shared_secret_arn" ]]; then
        echo "  -var core_case_runtime_smoke_shared_secret_arn=$core_case_runtime_smoke_shared_secret_arn"
        echo "  -var runtime_smoke_gl_coding_enabled=true"
    fi
}

main "$@"
