#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"

HTTP_API_STACK_NAME="${HTTP_API_STACK_NAME:-expenseflow-http-api-sandbox}"
BOOTSTRAP_STACK_NAME="${BOOTSTRAP_STACK_NAME:-expenseflow-platform-bootstrap-sandbox}"
DEPLOYMENT_ARTIFACT_BUCKET="${DEPLOYMENT_ARTIFACT_BUCKET:-}"
PACKAGED_TEMPLATE_FILE="${PACKAGED_TEMPLATE_FILE:-.aws-sam/scrum-152-packaged-template.yaml}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"
DISTRIBUTION_COMMENT="${DISTRIBUTION_COMMENT:-ExpenseFlow SCRUM-151 sandbox SPA}"
DEPLOY_SPA="${DEPLOY_SPA:-true}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

stack_parameter() {
    local parameter_key="$1"
    aws_cli cloudformation describe-stacks \
        --stack-name "$HTTP_API_STACK_NAME" \
        --query "Stacks[0].Parameters[?ParameterKey=='$parameter_key'].ParameterValue | [0]" \
        --output text
}

resolve_deployment_artifact_bucket() {
    if [[ -n "$DEPLOYMENT_ARTIFACT_BUCKET" ]]; then
        echo "$DEPLOYMENT_ARTIFACT_BUCKET"
        return
    fi

    aws_cli cloudformation describe-stacks \
        --stack-name "$BOOTSTRAP_STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='DeploymentArtifactBucketName'].OutputValue | [0]" \
        --output text
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

main() {
    local distribution_json distribution_arn distribution_domain spa_origin
    local jwt_issuer jwt_audience stage_name artifact_bucket api_id api_endpoint api_base_url

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

    jwt_issuer="$(stack_parameter JwtIssuer)"
    jwt_audience="$(stack_parameter JwtAudience)"
    stage_name="$(stack_parameter StageName)"
    if [[ -z "$jwt_issuer" || "$jwt_issuer" == "None" || -z "$jwt_audience" || "$jwt_audience" == "None" ]]; then
        echo "Unable to preserve the deployed stack's JWT issuer and audience." >&2
        exit 1
    fi
    if [[ -z "$stage_name" || "$stage_name" == "None" ]]; then
        stage_name="v1"
    fi

    npm --workspace platform/http-api run build:lambda
    artifact_bucket="$(resolve_deployment_artifact_bucket)"
    if [[ -z "$artifact_bucket" || "$artifact_bucket" == "None" ]]; then
        echo "Unable to resolve the deployment artifact bucket." >&2
        exit 1
    fi
    mkdir -p "$(dirname "$PACKAGED_TEMPLATE_FILE")"
    aws_cli cloudformation package \
        --template-file platform/http-api/template.yaml \
        --s3-bucket "$artifact_bucket" \
        --output-template-file "$PACKAGED_TEMPLATE_FILE"
    aws_cli cloudformation deploy \
        --template-file "$PACKAGED_TEMPLATE_FILE" \
        --stack-name "$HTTP_API_STACK_NAME" \
        --capabilities CAPABILITY_IAM \
        --no-fail-on-empty-changeset \
        --tags user=muhilramesh env=sandbox ticket=SCRUM-152 \
        --parameter-overrides \
            EnvironmentTag=sandbox \
            UserTag=muhilramesh \
            JwtIssuer="$jwt_issuer" \
            JwtAudience="$jwt_audience" \
            StageName="$stage_name" \
            SpaOrigin="$spa_origin"

    api_id="$(aws_cli cloudformation describe-stacks \
        --stack-name "$HTTP_API_STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='HttpApiId'].OutputValue | [0]" \
        --output text)"
    api_endpoint="$(aws_cli apigatewayv2 get-api --api-id "$api_id" --query ApiEndpoint --output text)"
    api_base_url="$api_endpoint/$stage_name"

    if [[ "$DEPLOY_SPA" == "true" ]]; then
        AWS_PROFILE="$AWS_PROFILE" \
            AWS_REGION="$AWS_REGION" \
            DISTRIBUTION_ID="$DISTRIBUTION_ID" \
            VITE_API_BASE_URL="$api_base_url" \
            scripts/aws/SCRUM-151/deploy-spa.sh
    fi

    echo "SCRUM-152 deployment completed."
    echo "SPA origin: $spa_origin"
    echo "API base URL: $api_base_url"
}

main "$@"
