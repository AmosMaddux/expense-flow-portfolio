#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIRM_RESOURCE_TEARDOWN="${CONFIRM_RESOURCE_TEARDOWN:-}"

STACK_NAME="${STACK_NAME:-expenseflow-issue-payment-http-api-sandbox}"
FUNCTION_NAME="${FUNCTION_NAME:-expenseflow-issue-payment-stub}"

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" ]]; then
    echo "Refusing to run destructive teardown with AWS_PROFILE=$AWS_PROFILE. Use the dedicated $EXPECTED_PROFILE sandbox profile." >&2
    exit 1
fi

if [[ "$CONFIRM_RESOURCE_TEARDOWN" != "SCRUM-150" ]]; then
    echo "Refusing to delete resources without CONFIRM_RESOURCE_TEARDOWN=SCRUM-150." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

require_stack_tags() {
    local is_owned

    is_owned="$(aws_cli cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "contains(Stacks[0].Tags[?Key=='user'].Value, 'muhilramesh') && contains(Stacks[0].Tags[?Key=='env'].Value, 'sandbox') && contains(Stacks[0].Tags[?Key=='ticket'].Value, 'SCRUM-150')" \
        --output text)"

    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete stack $STACK_NAME because SCRUM-150 ownership tags are missing." >&2
        return 1
    fi
}

require_lambda_tags_if_present() {
    local function_arn is_owned

    function_arn="$(aws_cli lambda get-function \
        --function-name "$FUNCTION_NAME" \
        --query 'Configuration.FunctionArn' \
        --output text 2>/dev/null || true)"
    if [[ -z "$function_arn" || "$function_arn" == "None" ]]; then
        return 0
    fi

    is_owned="$(aws_cli lambda list-tags \
        --resource "$function_arn" \
        --query "Tags.user == 'muhilramesh' && Tags.env == 'sandbox' && Tags.ticket == 'SCRUM-150'" \
        --output text)"

    if [[ "$is_owned" != "True" ]]; then
        echo "Refusing to delete Lambda function because SCRUM-150 ownership tags are missing." >&2
        return 1
    fi
}

main() {
    if ! aws_cli cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
        echo "Stack $STACK_NAME does not exist; nothing to delete."
        return 0
    fi

    require_stack_tags
    require_lambda_tags_if_present

    aws_cli cloudformation delete-stack --stack-name "$STACK_NAME"
    aws_cli cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"

    echo "Deleted SCRUM-150 Issue Payment Lambda stack $STACK_NAME. Shared HTTP API and ECS resources were left intact."
}

main "$@"
