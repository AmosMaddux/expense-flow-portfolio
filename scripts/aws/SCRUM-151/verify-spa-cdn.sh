#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

SPA_BUCKET_NAME="${SPA_BUCKET_NAME:-}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
DEEP_LINK_PATH="${DEEP_LINK_PATH:-/case-queue/scrum-151-verification}"

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
    bucket_name="$(resolve_bucket_name)"
    distribution_id_value="$(resolve_distribution_id)"
    if [[ -z "$distribution_id_value" || "$distribution_id_value" == "None" ]]; then
        echo "Missing SCRUM-151 CloudFront distribution." >&2
        exit 1
    fi

    public_access_blocked="$(aws_cli s3api get-public-access-block \
        --bucket "$bucket_name" \
        --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' \
        --output text)"
    if [[ "$public_access_blocked" != $'True\tTrue\tTrue\tTrue' ]]; then
        echo "Expected every S3 public-access block setting to be enabled." >&2
        exit 1
    fi

    ownership="$(aws_cli s3api get-bucket-ownership-controls \
        --bucket "$bucket_name" \
        --query 'OwnershipControls.Rules[0].ObjectOwnership' \
        --output text)"
    if [[ "$ownership" != "BucketOwnerEnforced" ]]; then
        echo "Expected S3 Object Ownership to be BucketOwnerEnforced, got $ownership." >&2
        exit 1
    fi

    aws_cli s3api head-object --bucket "$bucket_name" --key index.html >/dev/null

    distribution_status="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query 'Distribution.Status' \
        --output text)"
    if [[ "$distribution_status" != "Deployed" ]]; then
        echo "Expected CloudFront distribution to be Deployed, got $distribution_status." >&2
        exit 1
    fi

    oac_id="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query 'Distribution.DistributionConfig.Origins.Items[0].OriginAccessControlId' \
        --output text)"
    if [[ -z "$oac_id" || "$oac_id" == "None" ]]; then
        echo "Expected the S3 origin to use an origin access control." >&2
        exit 1
    fi

    fallback_count="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query "length(Distribution.DistributionConfig.CustomErrorResponses.Items[?ResponsePagePath=='/index.html' && ResponseCode=='200' && (ErrorCode==\`403\` || ErrorCode==\`404\`)])" \
        --output text)"
    if [[ "$fallback_count" != "2" ]]; then
        echo "Expected CloudFront 403 and 404 responses to fall back to /index.html with HTTP 200." >&2
        exit 1
    fi

    distribution_domain="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query 'Distribution.DomainName' \
        --output text)"
    root_file="$(mktemp)"
    deep_link_file="$(mktemp)"
    root_status="$(curl --silent --show-error --location --output "$root_file" --write-out '%{http_code}' "https://$distribution_domain/")"
    deep_link_status="$(curl --silent --show-error --location --output "$deep_link_file" --write-out '%{http_code}' "https://$distribution_domain$DEEP_LINK_PATH")"

    if [[ "$root_status" != "200" || "$deep_link_status" != "200" ]]; then
        rm -f "$root_file" "$deep_link_file"
        echo "Expected root and deep-link requests to return HTTP 200; got root=$root_status deep-link=$deep_link_status." >&2
        exit 1
    fi

    if ! cmp -s "$root_file" "$deep_link_file"; then
        rm -f "$root_file" "$deep_link_file"
        echo "Deep-link response did not match the SPA index document." >&2
        exit 1
    fi
    rm -f "$root_file" "$deep_link_file"

    echo "SCRUM-151 SPA CDN verification passed."
    echo "Bucket: $bucket_name (private)"
    echo "Distribution: $distribution_id_value ($distribution_status)"
    echo "OAC ID: $oac_id"
    echo "Deep link: https://$distribution_domain$DEEP_LINK_PATH"
}

main "$@"
