#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${ISSUE_PAYMENT_URL:?ISSUE_PAYMENT_URL is required}"
: "${VALID_ACCESS_TOKEN:?VALID_ACCESS_TOKEN is required}"
: "${EXPIRED_ACCESS_TOKEN:?EXPIRED_ACCESS_TOKEN is required}"
: "${EXPENSE_REPORT_ID:?EXPENSE_REPORT_ID is required}"

IDEMPOTENCY_KEY="${IDEMPOTENCY_KEY:-scrum-150-issue-payment-smoke}"
CORRELATION_ID="${CORRELATION_ID:-70000000-0000-4000-8000-000000001150}"
SETTLEMENT_REASON="${SETTLEMENT_REASON:-SCRUM-150 synthetic Issue Payment Lambda smoke.}"
EXPECTED_VALID_STATUS="${EXPECTED_VALID_STATUS:-200}"
EXPECTED_VALID_PROBLEM_TITLE="${EXPECTED_VALID_PROBLEM_TITLE:-}"

smoke_dir="$(mktemp -d)"
trap 'rm -rf "${smoke_dir}"' EXIT

if [[ "${ISSUE_PAYMENT_URL}" == *"{id}"* ]]; then
    issue_payment_url="${ISSUE_PAYMENT_URL/\{id\}/${EXPENSE_REPORT_ID}}"
elif [[ "${ISSUE_PAYMENT_URL}" != */settlement ]]; then
    issue_payment_url="${ISSUE_PAYMENT_URL%/}/expense-reports/${EXPENSE_REPORT_ID}/settlement"
else
    issue_payment_url="${ISSUE_PAYMENT_URL}"
fi

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

write_body() {
    local body_file="$1"

    SETTLEMENT_REASON="$SETTLEMENT_REASON" node --input-type=module -e '
import { writeFileSync } from "node:fs";
const reason = process.env.SETTLEMENT_REASON;
if (reason === undefined) throw new Error("Missing settlement reason.");
writeFileSync(process.argv[1], JSON.stringify({ reason }));
' "$body_file"
}

request_api() {
    local name="$1"
    local token="$2"
    local config_file="${smoke_dir}/${name}.curl-config"
    local body_file="${smoke_dir}/${name}.request.json"

    write_body "$body_file"
    {
        printf 'header = "Authorization: Bearer %s"\n' "${token}"
        printf 'header = "content-type: application/json"\n'
        printf 'header = "idempotency-key: %s"\n' "${IDEMPOTENCY_KEY}"
        printf 'header = "x-correlation-id: %s"\n' "${CORRELATION_ID}"
        printf 'request = "POST"\n'
        printf 'data = "@%s"\n' "${body_file}"
    } >"${config_file}"

    curl \
        --silent \
        --show-error \
        --config "${config_file}" \
        --dump-header "${smoke_dir}/${name}.headers" \
        --output "${smoke_dir}/${name}.body" \
        --write-out "%{http_code}" \
        "${issue_payment_url}"
}

valid_status="$(request_api valid "${VALID_ACCESS_TOKEN}")"
if [[ "${valid_status}" != "${EXPECTED_VALID_STATUS}" ]]; then
    echo "Expected the valid token to return ${EXPECTED_VALID_STATUS}; received ${valid_status}." >&2
    exit 1
fi
if [[ "${EXPECTED_VALID_STATUS}" == "200" ]]; then
    if ! grep -qi "^x-correlation-id: ${CORRELATION_ID}" "${smoke_dir}/valid.headers"; then
        echo "The valid Issue Payment response did not echo the expected x-correlation-id." >&2
        exit 1
    fi

    SMOKE_BODY_FILE="${smoke_dir}/valid.body" node --input-type=module -e '
import { readFileSync } from "node:fs";
const bodyFile = process.env.SMOKE_BODY_FILE;
if (bodyFile === undefined) throw new Error("Smoke response file is missing.");
const body = JSON.parse(readFileSync(bodyFile, "utf8"));
if (body?.currentStage !== "Reconciled") {
  throw new Error("Issue Payment smoke did not return a Reconciled Expense Report.");
}
'
elif [[ -n "${EXPECTED_VALID_PROBLEM_TITLE}" ]]; then
    SMOKE_BODY_FILE="${smoke_dir}/valid.body" EXPECTED_VALID_PROBLEM_TITLE="${EXPECTED_VALID_PROBLEM_TITLE}" node --input-type=module -e '
import { readFileSync } from "node:fs";
const bodyFile = process.env.SMOKE_BODY_FILE;
if (bodyFile === undefined) throw new Error("Smoke response file is missing.");
const body = JSON.parse(readFileSync(bodyFile, "utf8"));
if (body?.title !== process.env.EXPECTED_VALID_PROBLEM_TITLE) {
  throw new Error("Issue Payment smoke did not return the expected problem title.");
}
'
fi

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
    if grep -qi '^x-correlation-id:' "${smoke_dir}/${rejected_case}.headers"; then
        echo "The ${rejected_case} request unexpectedly reached Lambda/Core Case." >&2
        exit 1
    fi
done

echo "Issue Payment HTTP API smoke test passed: valid=200, expired=401, tampered=401."
