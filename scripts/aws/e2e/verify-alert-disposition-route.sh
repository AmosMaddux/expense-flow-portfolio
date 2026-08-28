#!/usr/bin/env bash
set -euo pipefail
umask 077

# Verifies the deployed Core Case alert-disposition read path against actual
# AWS resources. This script is read-only: it performs GET requests only and
# requires callers to supply short-lived synthetic JWTs through environment
# variables.

CORE_CASE_BASE_URL="${CORE_CASE_BASE_URL:-${PUBLIC_ALB_SMOKE_BASE_URL:-}}"
FINANCE_ADMIN_ACCESS_TOKEN="${FINANCE_ADMIN_ACCESS_TOKEN:-${VALID_ACCESS_TOKEN:-}}"
DENIED_ACCESS_TOKEN="${DENIED_ACCESS_TOKEN:-}"
EXPECTED_TENANT_ID="${EXPECTED_TENANT_ID:-}"
DISALLOWED_TENANT_ID="${DISALLOWED_TENANT_ID:-00000000-0000-4000-8000-00000000ffff}"
LIMIT="${LIMIT:-25}"

if [[ -z "$CORE_CASE_BASE_URL" ]]; then
    echo "CORE_CASE_BASE_URL or PUBLIC_ALB_SMOKE_BASE_URL is required." >&2
    exit 2
fi

if [[ -z "$FINANCE_ADMIN_ACCESS_TOKEN" ]]; then
    echo "FINANCE_ADMIN_ACCESS_TOKEN or VALID_ACCESS_TOKEN is required." >&2
    exit 2
fi

if [[ -z "$DENIED_ACCESS_TOKEN" ]]; then
    echo "DENIED_ACCESS_TOKEN is required. Use an Employee or Admin token." >&2
    exit 2
fi

if [[ -z "$EXPECTED_TENANT_ID" ]]; then
    echo "EXPECTED_TENANT_ID is required so tenant scope can be verified." >&2
    exit 2
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || (( LIMIT < 1 || LIMIT > 100 )); then
    echo "LIMIT must be an integer from 1 to 100." >&2
    exit 2
fi

require_tool() {
    local tool="$1"

    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is required. Install it before running this script." >&2
        exit 2
    fi
}

for tool in curl node; do
    require_tool "$tool"
done

base_url="${CORE_CASE_BASE_URL%/}"
route="/v1/internal/alert-dispositions"
tenant_override_query="limit=$LIMIT&tenantId=$DISALLOWED_TENANT_ID"
response_file="$(mktemp)"
denied_response_file="$(mktemp)"
allowed_curl_config="$(mktemp)"
denied_curl_config="$(mktemp)"

cleanup() {
    rm -f "$response_file" "$denied_response_file" "$allowed_curl_config" "$denied_curl_config"
}
trap cleanup EXIT

printf 'header = "Authorization: Bearer %s"\n' "$FINANCE_ADMIN_ACCESS_TOKEN" >"$allowed_curl_config"
printf 'header = "Authorization: Bearer %s"\n' "$DENIED_ACCESS_TOKEN" >"$denied_curl_config"

echo "Checking denied role access on $base_url$route..."
denied_status="$(curl \
    --silent \
    --show-error \
    --config "$denied_curl_config" \
    --output "$denied_response_file" \
    --write-out "%{http_code}" \
    "$base_url$route?limit=1")"

if [[ "$denied_status" != "403" ]]; then
    echo "Expected denied token to receive HTTP 403, got $denied_status." >&2
    exit 1
fi

echo "Checking Finance Admin tenant-scoped read on $base_url$route..."
allowed_status="$(curl \
    --silent \
    --show-error \
    --config "$allowed_curl_config" \
    --output "$response_file" \
    --write-out "%{http_code}" \
    "$base_url$route?$tenant_override_query")"

if [[ "$allowed_status" != "200" ]]; then
    echo "Expected Finance Admin token to receive HTTP 200, got $allowed_status." >&2
    exit 1
fi

EXPECTED_TENANT_ID="$EXPECTED_TENANT_ID" \
DISALLOWED_TENANT_ID="$DISALLOWED_TENANT_ID" \
node --input-type=module - "$response_file" <<'NODE'
import { readFileSync } from "node:fs";

const responsePath = process.argv[2];
const expectedTenantId = process.env.EXPECTED_TENANT_ID;
const disallowedTenantId = process.env.DISALLOWED_TENANT_ID;
const rows = JSON.parse(readFileSync(responsePath, "utf8"));

if (!Array.isArray(rows)) {
    throw new Error("Expected alert-disposition response to be an array.");
}

if (rows.length === 0) {
    throw new Error(
        "Expected at least one alert disposition for the expected tenant. Seed synthetic rows before running this verifier.",
    );
}

const wrongTenant = rows.find((row) => row?.tenantId !== expectedTenantId);
if (wrongTenant !== undefined) {
    throw new Error(
        `Expected every returned row to belong to ${expectedTenantId}; saw ${wrongTenant?.tenantId ?? "missing tenantId"}.`,
    );
}

const leakedTenant = rows.find((row) => row?.tenantId === disallowedTenantId);
if (leakedTenant !== undefined) {
    throw new Error(
        `Tenant override leaked row ${leakedTenant?.id ?? "with unknown id"} for ${disallowedTenantId}.`,
    );
}
NODE

echo "Alert-disposition deployed route verification passed."
