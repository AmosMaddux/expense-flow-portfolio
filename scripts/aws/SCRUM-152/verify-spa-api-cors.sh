#!/usr/bin/env bash
set -euo pipefail
umask 077

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

HTTP_API_STACK_NAME="${HTTP_API_STACK_NAME:-expenseflow-http-api-sandbox}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
VALID_ACCESS_TOKEN="${VALID_ACCESS_TOKEN:-}"
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

main() {
    local api_id api_endpoint stage_name api_base_url probe_url spa_domain spa_origin
    local allowed_status denied_status allow_origin allow_methods allow_headers
    local denied_allow_origin deployed_index asset_path deployed_asset auth_status auth_allow_origin

    DISTRIBUTION_ID="$(resolve_distribution_id)"
    if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
        echo "Unable to resolve the SCRUM-151 CloudFront distribution." >&2
        exit 1
    fi
    api_id="$(aws_cli cloudformation describe-stacks --stack-name "$HTTP_API_STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='HttpApiId'].OutputValue | [0]" --output text)"
    stage_name="$(aws_cli cloudformation describe-stacks --stack-name "$HTTP_API_STACK_NAME" --query "Stacks[0].Parameters[?ParameterKey=='StageName'].ParameterValue | [0]" --output text)"
    api_endpoint="$(aws_cli apigatewayv2 get-api --api-id "$api_id" --query ApiEndpoint --output text)"
    api_base_url="$api_endpoint/$stage_name"
    probe_url="$api_base_url/auth-context"
    spa_domain="$(aws_cli cloudfront get-distribution --id "$DISTRIBUTION_ID" --query Distribution.DomainName --output text)"
    spa_origin="https://$spa_domain"

    SMOKE_DIR="$(mktemp -d)"
    trap 'rm -rf "$SMOKE_DIR"' EXIT

    allowed_status="$(curl --silent --show-error --request OPTIONS \
        --header "Origin: $spa_origin" \
        --header 'Access-Control-Request-Method: GET' \
        --header 'Access-Control-Request-Headers: authorization,content-type' \
        --dump-header "$SMOKE_DIR/allowed.headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "$probe_url")"
    if [[ "$allowed_status" != "204" ]]; then
        echo "Expected allowed preflight to return 204; received $allowed_status." >&2
        exit 1
    fi

    allow_origin="$(header_value access-control-allow-origin "$SMOKE_DIR/allowed.headers")"
    allow_methods="$(header_value access-control-allow-methods "$SMOKE_DIR/allowed.headers")"
    allow_headers="$(header_value access-control-allow-headers "$SMOKE_DIR/allowed.headers")"
    if [[ "$allow_origin" != "$spa_origin" ]]; then
        echo "Allowed preflight did not return the exact SPA origin." >&2
        exit 1
    fi
    require_contains_word "$allow_methods" GET
    require_contains_word "$allow_headers" authorization
    require_contains_word "$allow_headers" content-type

    denied_status="$(curl --silent --show-error --request OPTIONS \
        --header 'Origin: https://untrusted.example.invalid' \
        --header 'Access-Control-Request-Method: GET' \
        --dump-header "$SMOKE_DIR/denied.headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "$probe_url")"
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
    if [[ "$deployed_asset" != *"$api_base_url"* ]]; then
        echo "The deployed Vite bundle does not contain the expected API base URL." >&2
        exit 1
    fi

    if [[ -z "$VALID_ACCESS_TOKEN" ]]; then
        echo "CORS and deployed-SPA wiring passed; authenticated smoke was not run because VALID_ACCESS_TOKEN is unset." >&2
        echo "Re-run with a current synthetic sandbox access token to complete the acceptance smoke." >&2
        exit 2
    fi

    printf 'header = "Origin: %s"\nheader = "Authorization: Bearer %s"\n' "$spa_origin" "$VALID_ACCESS_TOKEN" >"$SMOKE_DIR/auth.curl-config"
    auth_status="$(curl --silent --show-error \
        --config "$SMOKE_DIR/auth.curl-config" \
        --dump-header "$SMOKE_DIR/auth.headers" \
        --output "$SMOKE_DIR/auth.body" \
        --write-out '%{http_code}' \
        "$probe_url")"
    auth_allow_origin="$(header_value access-control-allow-origin "$SMOKE_DIR/auth.headers")"
    if [[ "$auth_status" != "200" || "$auth_allow_origin" != "$spa_origin" ]]; then
        echo "Authenticated SPA-origin request failed: status=$auth_status." >&2
        exit 1
    fi
    if ! grep -qi '^x-expenseflow-lambda-invoked: true' "$SMOKE_DIR/auth.headers"; then
        echo "Authenticated request did not reach the claims probe Lambda." >&2
        exit 1
    fi

    echo "SCRUM-152 verification passed: allowed=$allowed_status denied=$denied_status authenticated=$auth_status."
}

main "$@"
