#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

SPA_BUCKET_NAME="${SPA_BUCKET_NAME:-}"
CREATE_SPA_BUCKET="${CREATE_SPA_BUCKET:-true}"
OAC_NAME="${OAC_NAME:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
CACHE_POLICY_ID="${CACHE_POLICY_ID:-658327ea-f89d-4fab-a63d-7e88639e58f6}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
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

resolve_bucket_name() {
    if [[ -n "$SPA_BUCKET_NAME" ]]; then
        echo "$SPA_BUCKET_NAME"
        return
    fi

    if [[ "$CREATE_SPA_BUCKET" == "true" ]]; then
        echo "expenseflow-sandbox-spa-$(account_id)-$AWS_REGION"
        return
    fi

    echo "SPA_BUCKET_NAME is required when CREATE_SPA_BUCKET=false." >&2
    return 1
}

create_or_secure_bucket() {
    local bucket_name="$1"
    local bucket_created="false"
    local current_tags tags_file

    if ! aws_cli s3api head-bucket --bucket "$bucket_name" >/dev/null 2>&1; then
        if [[ "$CREATE_SPA_BUCKET" != "true" ]]; then
            echo "S3-EF-021 bucket $bucket_name does not exist or is not accessible." >&2
            return 1
        fi

        if [[ "$AWS_REGION" == "us-east-1" ]]; then
            aws_cli s3api create-bucket \
                --bucket "$bucket_name" \
                --object-ownership BucketOwnerEnforced \
                --create-bucket-configuration \
                'Tags=[{Key=user,Value=muhilramesh},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-151}]' >/dev/null
        else
            aws_cli s3api create-bucket \
                --bucket "$bucket_name" \
                --object-ownership BucketOwnerEnforced \
                --create-bucket-configuration \
                "LocationConstraint=$AWS_REGION,Tags=[{Key=user,Value=muhilramesh},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-151}]" >/dev/null
        fi
        bucket_created="true"
    fi

    aws_cli s3api put-public-access-block \
        --bucket "$bucket_name" \
        --public-access-block-configuration \
        BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    aws_cli s3api put-bucket-ownership-controls \
        --bucket "$bucket_name" \
        --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
    aws_cli s3api put-bucket-encryption \
        --bucket "$bucket_name" \
        --server-side-encryption-configuration \
        'Rules=[{ApplyServerSideEncryptionByDefault={SSEAlgorithm=AES256},BucketKeyEnabled=false}]'
    current_tags="$(aws_cli s3api get-bucket-tagging \
        --bucket "$bucket_name" \
        --query TagSet \
        --output json 2>/dev/null || echo '[]')"
    tags_file="$(mktemp)"
    CURRENT_TAGS="$current_tags" BUCKET_CREATED="$bucket_created" node - "$tags_file" <<'NODE'
const fs = require("fs");
const tags = new Map(JSON.parse(process.env.CURRENT_TAGS).map(({ Key, Value }) => [Key, Value]));
tags.set("user", "muhilramesh");
tags.set("env", "sandbox");
if (process.env.BUCKET_CREATED === "true") {
    tags.set("ticket", "SCRUM-151");
    tags.set("scrum-151-owned", "true");
} else {
    tags.set("scrum-151-consumer", "true");
}
fs.writeFileSync(process.argv[2], JSON.stringify({
    TagSet: [...tags].map(([Key, Value]) => ({ Key, Value })),
}));
NODE
    aws_cli s3api put-bucket-tagging --bucket "$bucket_name" --tagging "file://$tags_file"
    rm -f "$tags_file"
}

create_or_find_oac() {
    local oac_name="$1"
    local oac_id oac_config

    oac_id="$(aws_cli cloudfront list-origin-access-controls \
        --query "OriginAccessControlList.Items[?Name=='$oac_name'].Id | [0]" \
        --output text)"

    if [[ -z "$oac_id" || "$oac_id" == "None" ]]; then
        oac_id="$(aws_cli cloudfront create-origin-access-control \
            --origin-access-control-config \
            "Name=$oac_name,Description=SCRUM-151 private S3 SPA origin,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
            --query 'OriginAccessControl.Id' \
            --output text)" || return 1
    else
        oac_config="$(aws_cli cloudfront get-origin-access-control \
            --id "$oac_id" \
            --query 'OriginAccessControl.OriginAccessControlConfig.[SigningBehavior,SigningProtocol,OriginAccessControlOriginType]' \
            --output text)"
        if [[ "$oac_config" != $'always\tsigv4\ts3' ]]; then
            echo "Refusing to reuse OAC $oac_id because it is not configured for always-signed SigV4 S3 requests." >&2
            return 1
        fi
    fi

    echo "$oac_id"
}

distribution_id() {
    aws_cli cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='$DISTRIBUTION_COMMENT'].Id | [0]" \
        --output text
}

require_distribution_owned() {
    local distribution_id_value="$1"
    local distribution_arn is_owned

    distribution_arn="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query 'Distribution.ARN' \
        --output text)"
    is_owned="$(aws_cli cloudfront list-tags-for-resource \
        --resource "$distribution_arn" \
        --query "contains(Tags.Items[?Key=='user'].Value, 'muhilramesh') && contains(Tags.Items[?Key=='env'].Value, 'sandbox') && contains(Tags.Items[?Key=='ticket'].Value, 'SCRUM-151')" \
        --output text)"
    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to update distribution $distribution_id_value because SCRUM-151 ownership tags are missing." >&2
        return 1
    fi
}

write_distribution_config() {
    local output_file="$1"
    local bucket_name="$2"
    local oac_id="$3"
    local caller_reference="$4"

    BUCKET_NAME="$bucket_name" \
        OAC_ID="$oac_id" \
        CALLER_REFERENCE="$caller_reference" \
        DISTRIBUTION_COMMENT="$DISTRIBUTION_COMMENT" \
        CACHE_POLICY_ID="$CACHE_POLICY_ID" \
        AWS_REGION="$AWS_REGION" \
        node - "$output_file" <<'NODE'
const fs = require("fs");

const originId = "expenseflow-spa-s3";
const config = {
    CallerReference: process.env.CALLER_REFERENCE,
    Aliases: { Quantity: 0 },
    DefaultRootObject: "index.html",
    Origins: {
        Quantity: 1,
        Items: [
            {
                Id: originId,
                DomainName: `${process.env.BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`,
                OriginPath: "",
                CustomHeaders: { Quantity: 0 },
                S3OriginConfig: { OriginAccessIdentity: "" },
                ConnectionAttempts: 3,
                ConnectionTimeout: 10,
                OriginAccessControlId: process.env.OAC_ID,
            },
        ],
    },
    OriginGroups: { Quantity: 0 },
    DefaultCacheBehavior: {
        TargetOriginId: originId,
        TrustedSigners: { Enabled: false, Quantity: 0 },
        TrustedKeyGroups: { Enabled: false, Quantity: 0 },
        ViewerProtocolPolicy: "redirect-to-https",
        AllowedMethods: {
            Quantity: 2,
            Items: ["HEAD", "GET"],
            CachedMethods: { Quantity: 2, Items: ["HEAD", "GET"] },
        },
        SmoothStreaming: false,
        Compress: true,
        LambdaFunctionAssociations: { Quantity: 0 },
        FunctionAssociations: { Quantity: 0 },
        FieldLevelEncryptionId: "",
        CachePolicyId: process.env.CACHE_POLICY_ID,
    },
    CacheBehaviors: { Quantity: 0 },
    CustomErrorResponses: {
        Quantity: 2,
        Items: [403, 404].map((errorCode) => ({
            ErrorCode: errorCode,
            ResponsePagePath: "/index.html",
            ResponseCode: "200",
            ErrorCachingMinTTL: 0,
        })),
    },
    Comment: process.env.DISTRIBUTION_COMMENT,
    Logging: { Enabled: false, IncludeCookies: false, Bucket: "", Prefix: "" },
    PriceClass: "PriceClass_100",
    Enabled: true,
    ViewerCertificate: {
        CloudFrontDefaultCertificate: true,
        SSLSupportMethod: "vip",
        MinimumProtocolVersion: "TLSv1",
        CertificateSource: "cloudfront",
    },
    Restrictions: {
        GeoRestriction: { RestrictionType: "none", Quantity: 0 },
    },
    WebACLId: "",
    HttpVersion: "http2and3",
    IsIPV6Enabled: true,
};

fs.writeFileSync(process.argv[2], JSON.stringify(config, null, 2));
NODE
}

create_or_update_distribution() {
    local bucket_name="$1"
    local oac_id="$2"
    local config_file distribution_id_value caller_reference etag tagged_config_file

    distribution_id_value="$(distribution_id)"
    config_file="$(mktemp)"

    if [[ -z "$distribution_id_value" || "$distribution_id_value" == "None" ]]; then
        caller_reference="SCRUM-151-$(account_id)"
        write_distribution_config "$config_file" "$bucket_name" "$oac_id" "$caller_reference"
        tagged_config_file="$(mktemp)"
        DISTRIBUTION_CONFIG_FILE="$config_file" node - "$tagged_config_file" <<'NODE'
const fs = require("fs");
const distributionConfig = JSON.parse(fs.readFileSync(process.env.DISTRIBUTION_CONFIG_FILE, "utf8"));
fs.writeFileSync(process.argv[2], JSON.stringify({
    DistributionConfig: distributionConfig,
    Tags: {
        Items: [
            { Key: "user", Value: "muhilramesh" },
            { Key: "env", Value: "sandbox" },
            { Key: "ticket", Value: "SCRUM-151" },
        ],
    },
}, null, 2));
NODE
        distribution_id_value="$(aws_cli cloudfront create-distribution-with-tags \
            --distribution-config-with-tags "file://$tagged_config_file" \
            --query 'Distribution.Id' \
            --output text)" || {
            rm -f "$config_file" "$tagged_config_file"
            return 1
        }
        rm -f "$tagged_config_file"
    else
        require_distribution_owned "$distribution_id_value"
        caller_reference="$(aws_cli cloudfront get-distribution-config \
            --id "$distribution_id_value" \
            --query 'DistributionConfig.CallerReference' \
            --output text)"
        etag="$(aws_cli cloudfront get-distribution-config \
            --id "$distribution_id_value" \
            --query ETag \
            --output text)"
        write_distribution_config "$config_file" "$bucket_name" "$oac_id" "$caller_reference"
        if ! aws_cli cloudfront update-distribution \
            --id "$distribution_id_value" \
            --if-match "$etag" \
            --distribution-config "file://$config_file" >/dev/null; then
            rm -f "$config_file"
            return 1
        fi
        distribution_arn="$(aws_cli cloudfront get-distribution \
            --id "$distribution_id_value" \
            --query 'Distribution.ARN' \
            --output text)"
        aws_cli cloudfront tag-resource --resource "$distribution_arn" --tags "Items=[{Key=user,Value=muhilramesh},{Key=env,Value=sandbox},{Key=ticket,Value=SCRUM-151}]"
    fi

    rm -f "$config_file"
    echo "$distribution_id_value"
}

write_bucket_policy() {
    local bucket_name="$1"
    local distribution_id_value="$2"
    local existing_policy policy_file

    existing_policy="$(aws_cli s3api get-bucket-policy \
        --bucket "$bucket_name" \
        --query Policy \
        --output text 2>/dev/null || echo '{"Version":"2012-10-17","Statement":[]}')"
    policy_file="$(mktemp)"
    BUCKET_NAME="$bucket_name" \
        ACCOUNT_ID="$(account_id)" \
        DISTRIBUTION_ID="$distribution_id_value" \
        EXISTING_POLICY="$existing_policy" \
        node - "$policy_file" <<'NODE'
const fs = require("fs");
const bucketArn = `arn:aws:s3:::${process.env.BUCKET_NAME}`;
const policy = JSON.parse(process.env.EXISTING_POLICY);
const managedSids = new Set([
    "AllowCloudFrontServicePrincipalReadOnlySCRUM151",
    "DenyInsecureTransportSCRUM151",
]);
policy.Version = policy.Version || "2012-10-17";
policy.Statement = (policy.Statement || []).filter(({ Sid }) => !managedSids.has(Sid));
policy.Statement.push(
        {
            Sid: "AllowCloudFrontServicePrincipalReadOnlySCRUM151",
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: `${bucketArn}/*`,
            Condition: {
                StringEquals: {
                    "AWS:SourceArn": `arn:aws:cloudfront::${process.env.ACCOUNT_ID}:distribution/${process.env.DISTRIBUTION_ID}`,
                },
            },
        },
        {
            Sid: "DenyInsecureTransportSCRUM151",
            Effect: "Deny",
            Principal: "*",
            Action: "s3:*",
            Resource: [bucketArn, `${bucketArn}/*`],
            Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
);
fs.writeFileSync(process.argv[2], JSON.stringify(policy, null, 2));
NODE
    aws_cli s3api put-bucket-policy --bucket "$bucket_name" --policy "file://$policy_file"
    rm -f "$policy_file"
}

main() {
    echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
    aws_cli sts get-caller-identity >/dev/null

    bucket_name="$(resolve_bucket_name)"
    echo "Creating or securing private SPA bucket $bucket_name..."
    create_or_secure_bucket "$bucket_name"

    oac_name="$(resolve_oac_name)"
    echo "Creating or finding CloudFront OAC $oac_name..."
    if ! oac_id="$(create_or_find_oac "$oac_name")"; then
        echo "Could not create or validate CloudFront OAC $oac_name." >&2
        return 1
    fi

    echo "Creating or updating the SPA CloudFront distribution..."
    if ! distribution_id_value="$(create_or_update_distribution "$bucket_name" "$oac_id")"; then
        echo "Could not create or update the SCRUM-151 CloudFront distribution." >&2
        return 1
    fi
    write_bucket_policy "$bucket_name" "$distribution_id_value"

    distribution_domain="$(aws_cli cloudfront get-distribution \
        --id "$distribution_id_value" \
        --query 'Distribution.DomainName' \
        --output text)"

    echo "SCRUM-151 SPA CDN resources are ready."
    echo "Bucket: $bucket_name"
    echo "OAC ID: $oac_id"
    echo "Distribution ID: $distribution_id_value"
    echo "CloudFront URL: https://$distribution_domain"
}

main "$@"
