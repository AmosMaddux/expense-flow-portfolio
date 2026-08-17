#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

BACKEND_BASE_URL="${BACKEND_BASE_URL:-}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
CHECK_DIR=""

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

require_backend_origin() {
    BACKEND_BASE_URL="$BACKEND_BASE_URL" node --input-type=module -e '
const value = process.env.BACKEND_BASE_URL ?? "";
const url = new URL(value);
if (url.protocol !== "https:") throw new Error("BACKEND_BASE_URL must use HTTPS.");
if (value !== url.origin) throw new Error("BACKEND_BASE_URL must be an origin without /v1 or another path.");
'
}

require_distribution_approved() {
    local distribution_arn="$1"
    local approved

    approved="$(aws_cli cloudfront list-tags-for-resource \
        --resource "$distribution_arn" \
        --query "contains(Tags.Items[?Key=='user'].Value, 'muhilramesh') && contains(Tags.Items[?Key=='env'].Value, 'sandbox') && contains(Tags.Items[?Key=='ticket'].Value, 'SCRUM-151')" \
        --output text)"
    if [[ "$approved" != "True" ]]; then
        echo "Refusing to use CloudFront distribution $DISTRIBUTION_ID because its sandbox ownership tags do not match." >&2
        exit 1
    fi
}

require_core_case_surface() {
    local openapi_file="$1"

    curl --silent --show-error --fail \
        --output "$openapi_file" \
        "$BACKEND_BASE_URL/v1/openapi.json"
    OPENAPI_FILE="$openapi_file" node --input-type=module -e '
import { readFileSync } from "node:fs";
const document = JSON.parse(readFileSync(process.env.OPENAPI_FILE, "utf8"));
for (const path of ["/v1/auth/login", "/v1/case-queue/line-items"]) {
  if (document.paths?.[path] === undefined) throw new Error(`Core Case OpenAPI is missing ${path}.`);
}
'
}

main() {
    local distribution_json distribution_arn distribution_domain spa_origin
    local preflight_status allow_origin allow_credentials

    if [[ -z "$BACKEND_BASE_URL" ]]; then
        echo "BACKEND_BASE_URL is required and must be the certificate-valid public Core Case ALB origin." >&2
        exit 1
    fi
    require_backend_origin

    DISTRIBUTION_ID="$(resolve_distribution_id)"
    if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
        echo "Unable to resolve the SCRUM-151 CloudFront distribution." >&2
        exit 1
    fi
    distribution_json="$(aws_cli cloudfront get-distribution --id "$DISTRIBUTION_ID" --output json)"
    distribution_arn="$(DISTRIBUTION_JSON="$distribution_json" node --input-type=module -e 'const value = JSON.parse(process.env.DISTRIBUTION_JSON); process.stdout.write(value.Distribution.ARN);')"
    distribution_domain="$(DISTRIBUTION_JSON="$distribution_json" node --input-type=module -e 'const value = JSON.parse(process.env.DISTRIBUTION_JSON); process.stdout.write(value.Distribution.DomainName);')"
    require_distribution_approved "$distribution_arn"
    spa_origin="https://$distribution_domain"

    CHECK_DIR="$(mktemp -d)"
    trap 'rm -rf "$CHECK_DIR"' EXIT
    require_core_case_surface "$CHECK_DIR/openapi.json"

    preflight_status="$(curl --silent --show-error --request OPTIONS \
        --header "Origin: $spa_origin" \
        --header 'Access-Control-Request-Method: POST' \
        --header 'Access-Control-Request-Headers: content-type' \
        --dump-header "$CHECK_DIR/preflight.headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "$BACKEND_BASE_URL/v1/auth/login")"
    allow_origin="$(awk 'BEGIN { IGNORECASE=1 } /^access-control-allow-origin:/ { sub("^[^:]+:[[:space:]]*", ""); sub("\\r$", ""); print; exit }' "$CHECK_DIR/preflight.headers")"
    allow_credentials="$(awk 'BEGIN { IGNORECASE=1 } /^access-control-allow-credentials:/ { sub("^[^:]+:[[:space:]]*", ""); sub("\\r$", ""); print; exit }' "$CHECK_DIR/preflight.headers")"
    if [[ "$preflight_status" != "204" || "$allow_origin" != "$spa_origin" || "$allow_credentials" != "true" ]]; then
        echo "Core Case is not deployed with the SCRUM-152 credentialed CORS policy for $spa_origin." >&2
        exit 1
    fi

    AWS_PROFILE="$AWS_PROFILE" \
        AWS_REGION="$AWS_REGION" \
        DISTRIBUTION_ID="$DISTRIBUTION_ID" \
        VITE_API_BASE_URL="$BACKEND_BASE_URL" \
        scripts/aws/SCRUM-151/deploy-spa.sh

    echo "SCRUM-152 SPA deployment completed."
    echo "SPA origin: $spa_origin"
    echo "Core Case base URL: $BACKEND_BASE_URL"
}

main "$@"
