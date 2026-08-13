#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIRM_RESOURCE_TEARDOWN="${CONFIRM_RESOURCE_TEARDOWN:-}"

FUNCTION_NAME="${FUNCTION_NAME:-expenseflow-stage-transition-consumer}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-expenseflow-stage-transition-consumer-lambda-role}"
LAMBDA_SECURITY_GROUP_NAME="${LAMBDA_SECURITY_GROUP_NAME:-expenseflow-stage-transition-consumer-lambda-sg}"
LAMBDA_LOG_GROUP="${LAMBDA_LOG_GROUP:-/aws/lambda/$FUNCTION_NAME}"
VPC_ID="${VPC_ID:-}"
STAGE_TRANSITION_QUEUE_NAME="${STAGE_TRANSITION_QUEUE_NAME:-expenseflow-sandbox-stage-transition-events}"
STAGE_TRANSITION_DLQ_NAME="${STAGE_TRANSITION_DLQ_NAME:-expenseflow-sandbox-stage-transition-events-dlq}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" ]]; then
    echo "Refusing to run destructive teardown with AWS_PROFILE=$AWS_PROFILE. Use the dedicated $EXPECTED_PROFILE sandbox profile." >&2
    exit 1
fi

if [[ "$CONFIRM_RESOURCE_TEARDOWN" != "SCRUM-149" ]]; then
    echo "Refusing to delete resources without CONFIRM_RESOURCE_TEARDOWN=SCRUM-149." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

queue_url() {
    aws_cli sqs get-queue-url --queue-name "$1" --query QueueUrl --output text
}

queue_url_if_exists() {
    aws_cli sqs get-queue-url \
        --queue-name "$1" \
        --query QueueUrl \
        --output text 2>/dev/null || true
}

queue_arn() {
    local url="$1"

    aws_cli sqs get-queue-attributes \
        --queue-url "$url" \
        --attribute-names QueueArn \
        --query 'Attributes.QueueArn' \
        --output text
}

require_queue_tags() {
    local queue_name="$1"
    local queue_url="$2"
    local is_owned

    is_owned="$(aws_cli sqs list-queue-tags \
        --queue-url "$queue_url" \
        --query "Tags.user == 'muhilramesh' && Tags.env == 'sandbox' && Tags.ticket == 'SCRUM-149'" \
        --output text)"

    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete SQS queue $queue_name because SCRUM-149 ownership tags are missing." >&2
        return 1
    fi
}

require_lambda_tags() {
    local function_arn="$1"
    local is_owned

    is_owned="$(aws_cli lambda list-tags \
        --resource "$function_arn" \
        --query "Tags.user == 'muhilramesh' && Tags.env == 'sandbox' && Tags.ticket == 'SCRUM-149'" \
        --output text)"

    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete Lambda function because SCRUM-149 ownership tags are missing." >&2
        return 1
    fi
}

require_role_tags() {
    local is_owned

    is_owned="$(aws_cli iam list-role-tags \
        --role-name "$LAMBDA_ROLE_NAME" \
        --query "contains(Tags[?Key=='user'].Value, 'muhilramesh') && contains(Tags[?Key=='env'].Value, 'sandbox') && contains(Tags[?Key=='ticket'].Value, 'SCRUM-149')" \
        --output text)"

    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete IAM role because SCRUM-149 ownership tags are missing." >&2
        return 1
    fi
}

require_security_group_tags() {
    local group_id="$1"
    local is_owned

    is_owned="$(aws_cli ec2 describe-security-groups \
        --group-ids "$group_id" \
        --query "contains(SecurityGroups[0].Tags[?Key=='user'].Value, 'muhilramesh') && contains(SecurityGroups[0].Tags[?Key=='env'].Value, 'sandbox') && contains(SecurityGroups[0].Tags[?Key=='ticket'].Value, 'SCRUM-149')" \
        --output text)"

    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete security group $group_id because SCRUM-149 ownership tags are missing." >&2
        return 1
    fi
}

delete_event_source_mapping() {
    local source_queue_arn="$1"
    local mapping_uuids

    mapping_uuids="$(aws_cli lambda list-event-source-mappings \
        --function-name "$FUNCTION_NAME" \
        --event-source-arn "$source_queue_arn" \
        --query 'EventSourceMappings[].UUID' \
        --output text 2>/dev/null || true)"

    if [[ -z "$mapping_uuids" || "$mapping_uuids" == "None" ]]; then
        return 0
    fi

    for mapping_uuid in $mapping_uuids; do
        aws_cli lambda update-event-source-mapping \
            --uuid "$mapping_uuid" \
            --no-enabled >/dev/null 2>&1 || true
        aws_cli lambda delete-event-source-mapping --uuid "$mapping_uuid" >/dev/null
    done
}

delete_function() {
    local function_arn

    function_arn="$(aws_cli lambda get-function \
        --function-name "$FUNCTION_NAME" \
        --query 'Configuration.FunctionArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$function_arn" || "$function_arn" == "None" ]]; then
        return 0
    fi

    require_lambda_tags "$function_arn"
    aws_cli lambda delete-function --function-name "$FUNCTION_NAME" >/dev/null
}

delete_security_group() {
    local group_id
    local filters=(Name=group-name,Values="$LAMBDA_SECURITY_GROUP_NAME")

    if [[ -n "$VPC_ID" ]]; then
        filters=(Name=vpc-id,Values="$VPC_ID" "${filters[@]}")
    fi

    group_id="$(aws_cli ec2 describe-security-groups \
        --filters "${filters[@]}" \
        --query 'SecurityGroups[0].GroupId' \
        --output text 2>/dev/null || true)"

    if [[ -z "$group_id" || "$group_id" == "None" ]]; then
        return 0
    fi

    require_security_group_tags "$group_id"
    aws_cli ec2 delete-security-group --group-id "$group_id" >/dev/null
}

delete_queue_if_owned() {
    local queue_name="$1"
    local resolved_queue_url

    resolved_queue_url="$(queue_url_if_exists "$queue_name")"
    if [[ -z "$resolved_queue_url" || "$resolved_queue_url" == "None" ]]; then
        return 0
    fi

    require_queue_tags "$queue_name" "$resolved_queue_url"
    aws_cli sqs delete-queue --queue-url "$resolved_queue_url" >/dev/null
}

delete_role() {
    if ! aws_cli iam get-role --role-name "$LAMBDA_ROLE_NAME" >/dev/null 2>&1; then
        return 0
    fi

    require_role_tags
    policy_names="$(aws_cli iam list-role-policies \
        --role-name "$LAMBDA_ROLE_NAME" \
        --query 'PolicyNames[]' \
        --output text)"
    for policy_name in $policy_names; do
        aws_cli iam delete-role-policy \
            --role-name "$LAMBDA_ROLE_NAME" \
            --policy-name "$policy_name" >/dev/null
    done

    attached_policy_arns="$(aws_cli iam list-attached-role-policies \
        --role-name "$LAMBDA_ROLE_NAME" \
        --query 'AttachedPolicies[].PolicyArn' \
        --output text)"
    for policy_arn in $attached_policy_arns; do
        aws_cli iam detach-role-policy \
            --role-name "$LAMBDA_ROLE_NAME" \
            --policy-arn "$policy_arn" >/dev/null
    done

    aws_cli iam delete-role --role-name "$LAMBDA_ROLE_NAME" >/dev/null
}

main() {
    source_queue_url="$(queue_url_if_exists "$STAGE_TRANSITION_QUEUE_NAME")"

    if [[ -n "$source_queue_url" && "$source_queue_url" != "None" ]]; then
        source_queue_arn="$(queue_arn "$source_queue_url")"
        delete_event_source_mapping "$source_queue_arn"
    fi
    delete_function
    aws_cli logs delete-log-group --log-group-name "$LAMBDA_LOG_GROUP" >/dev/null 2>&1 || true
    delete_security_group
    delete_role
    delete_queue_if_owned "$STAGE_TRANSITION_QUEUE_NAME"
    delete_queue_if_owned "$STAGE_TRANSITION_DLQ_NAME"

    echo "Deleted SCRUM-149 Lambda and SQS resources. Shared SCRUM-147 SNS and VPC resources were left intact."
}

main "$@"
