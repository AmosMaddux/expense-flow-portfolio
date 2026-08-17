#!/usr/bin/env bash
set -euo pipefail
umask 077

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

BACKEND_BASE_URL="${BACKEND_BASE_URL:-}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
VALID_ACCESS_TOKEN="${VALID_ACCESS_TOKEN:-}"
AUTHENTICATED_SMOKE_PATH="${AUTHENTICATED_SMOKE_PATH:-/v1/case-queue/line-items}"
MUTATION_SMOKE_PATH="${MUTATION_SMOKE_PATH:-/v1/expense-reports}"
SMOKE_DIR=""

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

resolve_distribution_id() {
    if [[ -n "$DISTRIBUTION_ID" ]]; then
        echo "$DISTRIBUTION_ID"
        return
    fi

    aws_cli cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='$DISTRIBUTION_COMMENT'].Id | [0]" \
        --output text
}

header_value() {
    local header_name="$1"
    local header_file="$2"
    awk -v name="$header_name" 'BEGIN { IGNORECASE=1 } $0 ~ "^" name ":" { sub("^[^:]+:[[:space:]]*", ""); sub("\\r$", ""); print; exit }' "$header_file"
}

require_contains_word() {
    local list_value="$1"
    local expected="$2"
    LIST_VALUE="$list_value" EXPECTED="$expected" node --input-type=module -e '
const words = (process.env.LIST_VALUE ?? "").split(",").map((word) => word.trim().toLowerCase());
if (!words.includes((process.env.EXPECTED ?? "").toLowerCase())) process.exit(1);
'
}

require_backend_origin() {
    BACKEND_BASE_URL="$BACKEND_BASE_URL" AUTHENTICATED_SMOKE_PATH="$AUTHENTICATED_SMOKE_PATH" MUTATION_SMOKE_PATH="$MUTATION_SMOKE_PATH" node --input-type=module -e '
const base = process.env.BACKEND_BASE_URL ?? "";
const url = new URL(base);
if (url.protocol !== "https:") throw new Error("BACKEND_BASE_URL must use HTTPS.");
if (base !== url.origin) throw new Error("BACKEND_BASE_URL must not include /v1 or another path.");
if (!(process.env.AUTHENTICATED_SMOKE_PATH ?? "").startsWith("/v1/")) throw new Error("AUTHENTICATED_SMOKE_PATH must start with /v1/.");
if (!(process.env.MUTATION_SMOKE_PATH ?? "").startsWith("/v1/")) throw new Error("MUTATION_SMOKE_PATH must start with /v1/.");
'
}

main() {
    local spa_domain spa_origin login_url authenticated_url mutation_url
    local mutation_status mutation_allow_origin mutation_allow_credentials mutation_allow_headers
    local allowed_status denied_status allow_origin allow_credentials allow_methods allow_headers
    local denied_allow_origin deployed_index asset_path deployed_asset auth_status auth_allow_origin auth_allow_credentials

    if [[ -z "$BACKEND_BASE_URL" ]]; then
        echo "BACKEND_BASE_URL is required and must be the public Core Case ALB origin." >&2
        exit 1
    fi
    require_backend_origin

    DISTRIBUTION_ID="$(resolve_distribution_id)"
    if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
        echo "Unable to resolve the SCRUM-151 CloudFront distribution." >&2
        exit 1
    fi
    spa_domain="$(aws_cli cloudfront get-distribution --id "$DISTRIBUTION_ID" --query Distribution.DomainName --output text)"
    spa_origin="https://$spa_domain"
    login_url="$BACKEND_BASE_URL/v1/auth/login"
    authenticated_url="$BACKEND_BASE_URL$AUTHENTICATED_SMOKE_PATH"
    mutation_url="$BACKEND_BASE_URL$MUTATION_SMOKE_PATH"

    SMOKE_DIR="$(mktemp -d)"
    trap 'rm -rf "$SMOKE_DIR"' EXIT

    curl --silent --show-error --fail \
        --output "$SMOKE_DIR/openapi.json" \
        "$BACKEND_BASE_URL/v1/openapi.json"
    OPENAPI_FILE="$SMOKE_DIR/openapi.json" node --input-type=module -e '
import { readFileSync } from "node:fs";
const document = JSON.parse(readFileSync(process.env.OPENAPI_FILE, "utf8"));
for (const path of ["/v1/auth/login", "/v1/case-queue/line-items"]) {
  if (document.paths?.[path] === undefined) throw new Error(`Core Case OpenAPI is missing ${path}.`);
}
'

    allowed_status="$(curl --silent --show-error --request OPTIONS \
        --header "Origin: $spa_origin" \
        --header 'Access-Control-Request-Method: POST' \
        --header 'Access-Control-Request-Headers: content-type' \
        --dump-header "$SMOKE_DIR/allowed.headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "$login_url")"
    allow_origin="$(header_value access-control-allow-origin "$SMOKE_DIR/allowed.headers")"
    allow_credentials="$(header_value access-control-allow-credentials "$SMOKE_DIR/allowed.headers")"
    allow_methods="$(header_value access-control-allow-methods "$SMOKE_DIR/allowed.headers")"
    allow_headers="$(header_value access-control-allow-headers "$SMOKE_DIR/allowed.headers")"
    if [[ "$allowed_status" != "204" || "$allow_origin" != "$spa_origin" || "$allow_credentials" != "true" ]]; then
        echo "Credentialed login preflight failed for the exact SPA origin." >&2
        exit 1
    fi
    require_contains_word "$allow_methods" POST
    require_contains_word "$allow_headers" content-type

    # The SPA sends Idempotency-Key on expense submission, draft updates, and
    # mileage logging, so preflight a real mutation route with the full set.
    mutation_status="$(curl --silent --show-error --request OPTIONS \
        --header "Origin: $spa_origin" \
        --header 'Access-Control-Request-Method: POST' \
        --header 'Access-Control-Request-Headers: authorization,content-type,idempotency-key' \
        --dump-header "$SMOKE_DIR/mutation.headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "$mutation_url")"
    mutation_allow_origin="$(header_value access-control-allow-origin "$SMOKE_DIR/mutation.headers")"
    mutation_allow_credentials="$(header_value access-control-allow-credentials "$SMOKE_DIR/mutation.headers")"
    mutation_allow_headers="$(header_value access-control-allow-headers "$SMOKE_DIR/mutation.headers")"
    if [[ "$mutation_status" != "204" || "$mutation_allow_origin" != "$spa_origin" || "$mutation_allow_credentials" != "true" ]]; then
        echo "Credentialed mutation preflight failed for $MUTATION_SMOKE_PATH." >&2
        exit 1
    fi
    require_contains_word "$mutation_allow_headers" authorization
    require_contains_word "$mutation_allow_headers" content-type
    require_contains_word "$mutation_allow_headers" idempotency-key

    denied_status="$(curl --silent --show-error --request OPTIONS \
        --header 'Origin: https://untrusted.example.invalid' \
        --header 'Access-Control-Request-Method: POST' \
        --dump-header "$SMOKE_DIR/denied.headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "$login_url")"
    denied_allow_origin="$(header_value access-control-allow-origin "$SMOKE_DIR/denied.headers")"
    if [[ -n "$denied_allow_origin" ]]; then
        echo "Untrusted preflight unexpectedly received access-control-allow-origin: $denied_allow_origin" >&2
        exit 1
    fi

    deployed_index="$(curl --silent --show-error --fail "$spa_origin/")"
    asset_path="$(INDEX_HTML="$deployed_index" node --input-type=module -e '
const match = (process.env.INDEX_HTML ?? "").match(/<script[^>]+src="([^"]+\.js)"/);
if (!match) process.exit(1);
process.stdout.write(match[1]);
')"
    deployed_asset="$(curl --silent --show-error --fail "$spa_origin$asset_path")"
    if [[ "$deployed_asset" != *"$BACKEND_BASE_URL"* ]]; then
        echo "The deployed Vite bundle does not contain the Core Case origin." >&2
        exit 1
    fi
    if [[ "$deployed_asset" == *"$BACKEND_BASE_URL/v1/v1"* ]]; then
        echo "The deployed Vite bundle contains a duplicated /v1 path." >&2
        exit 1
    fi

    if [[ -z "$VALID_ACCESS_TOKEN" ]]; then
        echo "SCRUM-152 verification is incomplete: no authenticated application request was run." >&2
        echo "The backend/login dependency must supply a current synthetic sandbox access token." >&2
        exit 2
    fi

    printf 'header = "Origin: %s"\nheader = "Authorization: Bearer %s"\n' "$spa_origin" "$VALID_ACCESS_TOKEN" >"$SMOKE_DIR/auth.curl-config"
    auth_status="$(curl --silent --show-error \
        --config "$SMOKE_DIR/auth.curl-config" \
        --dump-header "$SMOKE_DIR/auth.headers" \
        --output "$SMOKE_DIR/auth.body" \
        --write-out '%{http_code}' \
        "$authenticated_url")"
    auth_allow_origin="$(header_value access-control-allow-origin "$SMOKE_DIR/auth.headers")"
    auth_allow_credentials="$(header_value access-control-allow-credentials "$SMOKE_DIR/auth.headers")"
    if [[ "$auth_status" != "200" || "$auth_allow_origin" != "$spa_origin" || "$auth_allow_credentials" != "true" ]]; then
        echo "Authenticated SPA-origin application request failed: status=$auth_status." >&2
        exit 1
    fi

    echo "SCRUM-152 verification passed: preflight=$allowed_status mutation=$mutation_status denied=$denied_status authenticated=$auth_status."
}

main "$@"
