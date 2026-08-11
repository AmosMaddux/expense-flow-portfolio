#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${HTTP_API_PROBE_URL:?HTTP_API_PROBE_URL is required}"
: "${VALID_ACCESS_TOKEN:?VALID_ACCESS_TOKEN is required}"
: "${EXPIRED_ACCESS_TOKEN:?EXPIRED_ACCESS_TOKEN is required}"

smoke_dir="$(mktemp -d)"
trap 'rm -rf "${smoke_dir}"' EXIT

tamper_token() {
    local token="$1"
    local header payload signature first_character replacement

    IFS="." read -r header payload signature <<<"${token}"
    if [[ -z "${header}" || -z "${payload}" || -z "${signature}" ]]; then
        echo "VALID_ACCESS_TOKEN is not a three-segment JWT." >&2
        exit 1
    fi

    first_character="${signature:0:1}"
    replacement="A"
    if [[ "${first_character}" == "A" ]]; then
        replacement="B"
    fi

    printf "%s.%s.%s%s" \
        "${header}" \
        "${payload}" \
        "${replacement}" \
        "${signature:1}"
}

request_api() {
    local name="$1"
    local token="$2"
    local config_file="${smoke_dir}/${name}.curl-config"

    printf 'header = "Authorization: Bearer %s"\n' "${token}" >"${config_file}"

    curl \
        --silent \
        --show-error \
        --config "${config_file}" \
        --dump-header "${smoke_dir}/${name}.headers" \
        --output "${smoke_dir}/${name}.body" \
        --write-out "%{http_code}" \
        "${HTTP_API_PROBE_URL}"
}

valid_status="$(request_api valid "${VALID_ACCESS_TOKEN}")"
if [[ "${valid_status}" != "200" ]]; then
    echo "Expected the valid token to return 200; received ${valid_status}." >&2
    exit 1
fi
if ! grep -qi '^x-expenseflow-lambda-invoked: true' "${smoke_dir}/valid.headers"; then
    echo "The valid request did not reach the claims probe Lambda." >&2
    exit 1
fi

SMOKE_BODY_FILE="${smoke_dir}/valid.body" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const bodyFile = process.env.SMOKE_BODY_FILE;
    if (bodyFile === undefined) throw new Error("Smoke response file is missing.");
    const body = JSON.parse(readFileSync(bodyFile, "utf8"));
    if (body?.verifiedClaims?.tenantIdPresent !== true) {
        throw new Error("The verified tenant claim was not exposed to Lambda.");
    }
    if (!Array.isArray(body?.verifiedClaims?.roles) || body.verifiedClaims.roles.length === 0) {
        throw new Error("The verified roles claim was not exposed to Lambda.");
    }
'

tampered_access_token="$(tamper_token "${VALID_ACCESS_TOKEN}")"
for rejected_case in expired tampered; do
    rejected_token="${EXPIRED_ACCESS_TOKEN}"
    if [[ "${rejected_case}" == "tampered" ]]; then
        rejected_token="${tampered_access_token}"
    fi

    rejected_status="$(request_api "${rejected_case}" "${rejected_token}")"
    if [[ "${rejected_status}" != "401" ]]; then
        echo "Expected the ${rejected_case} token to return 401; received ${rejected_status}." >&2
        exit 1
    fi
    if grep -qi '^x-expenseflow-lambda-invoked:' "${smoke_dir}/${rejected_case}.headers"; then
        echo "The ${rejected_case} request unexpectedly reached Lambda." >&2
        exit 1
    fi
done

echo "HTTP API JWT smoke test passed: valid=200, expired=401, tampered=401."
