#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

SPA_BUCKET_NAME="${SPA_BUCKET_NAME:-}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"
WAIT_FOR_INVALIDATION="${WAIT_FOR_INVALIDATION:-true}"
BUILD_DIRECTORY="${BUILD_DIRECTORY:-frontend/app/dist}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

resolve_bucket_name() {
    if [[ -n "$SPA_BUCKET_NAME" ]]; then
        echo "$SPA_BUCKET_NAME"
        return
    fi

    echo "expenseflow-sandbox-spa-$(account_id)-$AWS_REGION"
}

account_id() {
    aws_cli sts get-caller-identity --query Account --output text
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

main() {
    echo "Building the Vite SPA..."
    VITE_API_BASE_URL="$VITE_API_BASE_URL" npm --workspace frontend/app run build

    if [[ ! -f "$BUILD_DIRECTORY/index.html" ]]; then
        echo "Missing $BUILD_DIRECTORY/index.html after the Vite build." >&2
        exit 1
    fi

    bucket_name="$(resolve_bucket_name)"
    distribution_id_value="$(resolve_distribution_id)"
    if [[ -z "$distribution_id_value" || "$distribution_id_value" == "None" ]]; then
        echo "Missing SCRUM-151 CloudFront distribution. Run create-spa-cdn-resources.sh first." >&2
        exit 1
    fi

    echo "Syncing the Vite build to private bucket $bucket_name..."
    aws_cli s3 sync "$BUILD_DIRECTORY" "s3://$bucket_name" \
        --delete \
        --cache-control 'public,max-age=3600'

    if [[ -d "$BUILD_DIRECTORY/assets" ]]; then
        aws_cli s3 cp "$BUILD_DIRECTORY/assets" "s3://$bucket_name/assets" \
            --recursive \
            --cache-control 'public,max-age=31536000,immutable'
    fi

    aws_cli s3 cp "$BUILD_DIRECTORY/index.html" "s3://$bucket_name/index.html" \
        --cache-control 'no-cache,no-store,must-revalidate' \
        --content-type 'text/html'

    echo "Invalidating CloudFront cache for distribution $distribution_id_value..."
    invalidation_id="$(aws_cli cloudfront create-invalidation \
        --distribution-id "$distribution_id_value" \
        --paths '/*' \
        --query 'Invalidation.Id' \
        --output text)"

    if [[ "$WAIT_FOR_INVALIDATION" == "true" ]]; then
        aws_cli cloudfront wait invalidation-completed \
            --distribution-id "$distribution_id_value" \
            --id "$invalidation_id"
    fi

    distribution_domain="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query 'Distribution.DomainName' \
        --output text)"
    echo "SCRUM-151 SPA deployment completed."
    echo "Invalidation ID: $invalidation_id"
    echo "CloudFront URL: https://$distribution_domain"
}

main "$@"
