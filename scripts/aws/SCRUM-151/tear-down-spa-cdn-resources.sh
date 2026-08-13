#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIRM_RESOURCE_TEARDOWN="${CONFIRM_RESOURCE_TEARDOWN:-}"

SPA_BUCKET_NAME="${SPA_BUCKET_NAME:-}"
OAC_NAME="${OAC_NAME:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" ]]; then
    echo "Refusing destructive teardown with AWS_PROFILE=$AWS_PROFILE. Use the dedicated $EXPECTED_PROFILE sandbox profile." >&2
    exit 1
fi

if [[ "$CONFIRM_RESOURCE_TEARDOWN" != "SCRUM-151" ]]; then
    echo "Refusing to delete resources without CONFIRM_RESOURCE_TEARDOWN=SCRUM-151." >&2
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

resolve_oac_name() {
    if [[ -n "$OAC_NAME" ]]; then
        echo "$OAC_NAME"
        return
    fi

    echo "expenseflow-scrum-151-$(account_id)-spa-oac"
}

require_oac_unused() {
    local oac_id="$1"
    local referencing_distribution_ids

    referencing_distribution_ids="$(aws_cli cloudfront list-distributions \
        --query "DistributionList.Items[?Origins.Items[?OriginAccessControlId=='$oac_id']].Id" \
        --output text)"
    if [[ -n "$referencing_distribution_ids" && "$referencing_distribution_ids" != "None" ]]; then
        echo "Refusing to delete OAC $oac_id because distributions still reference it: $referencing_distribution_ids" >&2
        return 1
    fi
}

require_oac_config() {
    local oac_id="$1"
    local oac_config

    oac_config="$(aws_cli cloudfront get-origin-access-control \
        --id "$oac_id" \
        --query 'OriginAccessControl.OriginAccessControlConfig.[SigningBehavior,SigningProtocol,OriginAccessControlOriginType]' \
        --output text)"
    if [[ "$oac_config" != $'always\tsigv4\ts3' ]]; then
        echo "Refusing to delete OAC $oac_id because its configuration does not match SCRUM-151." >&2
        return 1
    fi
}

require_distribution_tags() {
    local distribution_arn="$1"
    local is_owned

    is_owned="$(aws_cli cloudfront list-tags-for-resource \
        --resource "$distribution_arn" \
        --query "contains(Tags.Items[?Key=='user'].Value, 'muhilramesh') && contains(Tags.Items[?Key=='env'].Value, 'sandbox') && contains(Tags.Items[?Key=='ticket'].Value, 'SCRUM-151')" \
        --output text)"
    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete CloudFront distribution because SCRUM-151 ownership tags are missing." >&2
        return 1
    fi
}

bucket_owned_by_scrum_151() {
    local bucket_name="$1"
    local is_owned

    is_owned="$(aws_cli s3api get-bucket-tagging \
        --bucket "$bucket_name" \
        --query "contains(TagSet[?Key=='user'].Value, 'muhilramesh') && contains(TagSet[?Key=='env'].Value, 'sandbox') && contains(TagSet[?Key=='ticket'].Value, 'SCRUM-151') && contains(TagSet[?Key=='scrum-151-owned'].Value, 'true')" \
        --output text)"

    [[ "$is_owned" == "True" ]]
}

remove_shared_bucket_policy_statements() {
    local bucket_name="$1"
    local existing_policy policy_file statement_count

    existing_policy="$(aws_cli s3api get-bucket-policy \
        --bucket "$bucket_name" \
        --query Policy \
        --output text 2>/dev/null || true)"
    if [[ -z "$existing_policy" || "$existing_policy" == "None" ]]; then
        return
    fi

    policy_file="$(mktemp)"
    EXISTING_POLICY="$existing_policy" node - "$policy_file" <<'NODE'
const fs = require("fs");
const policy = JSON.parse(process.env.EXISTING_POLICY);
const managedSids = new Set([
    "AllowCloudFrontServicePrincipalReadOnlySCRUM151",
    "DenyInsecureTransportSCRUM151",
]);
policy.Statement = (policy.Statement || []).filter(({ Sid }) => !managedSids.has(Sid));
fs.writeFileSync(process.argv[2], JSON.stringify(policy, null, 2));
NODE
    statement_count="$(node -e "const p=require(process.argv[1]); console.log((p.Statement || []).length)" "$policy_file")"
    if [[ "$statement_count" == "0" ]]; then
        aws_cli s3api delete-bucket-policy --bucket "$bucket_name"
    else
        aws_cli s3api put-bucket-policy --bucket "$bucket_name" --policy "file://$policy_file"
    fi
    rm -f "$policy_file"
}

main() {
    bucket_name="$(resolve_bucket_name)"
    distribution_id_value="$(aws_cli cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='$DISTRIBUTION_COMMENT'].Id | [0]" \
        --output text)"

    if [[ -n "$distribution_id_value" && "$distribution_id_value" != "None" ]]; then
        distribution_arn="$(aws_cli cloudfront get-distribution \
            --id "$distribution_id_value" \
            --query 'Distribution.ARN' \
            --output text)"
        require_distribution_tags "$distribution_arn"

        enabled="$(aws_cli cloudfront get-distribution-config \
            --id "$distribution_id_value" \
            --query 'DistributionConfig.Enabled' \
            --output text)"
        if [[ "$enabled" == "True" ]]; then
            config_file="$(mktemp)"
            aws_cli cloudfront get-distribution-config \
                --id "$distribution_id_value" \
                --query DistributionConfig \
                --output json >"$config_file"
            node - "$config_file" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.Enabled = false;
fs.writeFileSync(path, JSON.stringify(config, null, 2));
NODE
            etag="$(aws_cli cloudfront get-distribution-config \
                --id "$distribution_id_value" \
                --query ETag \
                --output text)"
            aws_cli cloudfront update-distribution \
                --id "$distribution_id_value" \
                --if-match "$etag" \
                --distribution-config "file://$config_file" >/dev/null
            rm -f "$config_file"
            aws_cli cloudfront wait distribution-deployed --id "$distribution_id_value"
        fi

        etag="$(aws_cli cloudfront get-distribution-config \
            --id "$distribution_id_value" \
            --query ETag \
            --output text)"
        aws_cli cloudfront delete-distribution --id "$distribution_id_value" --if-match "$etag"
    fi

    oac_name="$(resolve_oac_name)"
    oac_id="$(aws_cli cloudfront list-origin-access-controls \
        --query "OriginAccessControlList.Items[?Name=='$oac_name'].Id | [0]" \
        --output text)"
    if [[ -n "$oac_id" && "$oac_id" != "None" ]]; then
        require_oac_config "$oac_id"
        require_oac_unused "$oac_id"
        oac_etag="$(aws_cli cloudfront get-origin-access-control \
            --id "$oac_id" \
            --query ETag \
            --output text)"
        aws_cli cloudfront delete-origin-access-control --id "$oac_id" --if-match "$oac_etag"
    fi

    if aws_cli s3api head-bucket --bucket "$bucket_name" >/dev/null 2>&1; then
        if bucket_owned_by_scrum_151 "$bucket_name"; then
            aws_cli s3 rm "s3://$bucket_name" --recursive
            aws_cli s3api delete-bucket --bucket "$bucket_name"
        else
            remove_shared_bucket_policy_statements "$bucket_name"
            echo "Leaving shared S3-EF-021 bucket $bucket_name intact."
        fi
    fi

    echo "Deleted SCRUM-151 CloudFront distribution and OAC."
}

main "$@"
