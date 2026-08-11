#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROFILE="expenseflow-smoke"
AWS_PROFILE="${AWS_PROFILE:-$EXPECTED_PROFILE}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ALLOW_NON_SMOKE_PROFILE="${ALLOW_NON_SMOKE_PROFILE:-false}"
DYNAMODB_EXPENSE_REPORT_TABLE="${DYNAMODB_EXPENSE_REPORT_TABLE:-expenseflow-expense-reports}"
DYNAMODB_EXPENSE_REPORT_TENANT_INDEX="${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX:-tenantId-index}"

TAGS=(Key=user,Value=amos-maddux Key=env,Value=sandbox Key=ticket,Value=SCRUM-147)

if [[ "$AWS_PROFILE" != "$EXPECTED_PROFILE" && "$ALLOW_NON_SMOKE_PROFILE" != "true" ]]; then
    echo "Refusing to run with AWS_PROFILE=$AWS_PROFILE. Set ALLOW_NON_SMOKE_PROFILE=true to override." >&2
    exit 1
fi

aws_cli() {
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

create_or_tag_expense_report_table() {
    local table_name="$1"
    local tenant_index_name="$2"
    local table_arn
    local hash_key
    local tenant_index_status

    table_arn="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query 'Table.TableArn' \
        --output text 2>/dev/null || true)"

    if [[ -z "$table_arn" || "$table_arn" == "None" ]]; then
        table_arn="$(aws_cli dynamodb create-table \
            --table-name "$table_name" \
            --attribute-definitions \
                AttributeName=id,AttributeType=S \
                AttributeName=tenantId,AttributeType=S \
            --key-schema \
                AttributeName=id,KeyType=HASH \
            --global-secondary-indexes \
                "IndexName=$tenant_index_name,KeySchema=[{AttributeName=tenantId,KeyType=HASH}],Projection={ProjectionType=ALL}" \
            --billing-mode PAY_PER_REQUEST \
            --tags "${TAGS[@]}" \
            --query 'TableDescription.TableArn' \
            --output text)"
        aws_cli dynamodb wait table-exists --table-name "$table_name"
    fi

    hash_key="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query "Table.KeySchema[?KeyType=='HASH']|[0].AttributeName" \
        --output text)"
    if [[ "$hash_key" != "id" ]]; then
        echo "DynamoDB table $table_name uses HASH key $hash_key, but local ExpenseFlow expects id." >&2
        return 1
    fi

    tenant_index_status="$(aws_cli dynamodb describe-table \
        --table-name "$table_name" \
        --query "Table.GlobalSecondaryIndexes[?IndexName=='$tenant_index_name']|[0].IndexStatus" \
        --output text)"
    if [[ -z "$tenant_index_status" || "$tenant_index_status" == "None" ]]; then
        echo "DynamoDB table $table_name exists without required GSI $tenant_index_name." >&2
        return 1
    fi

    aws_cli dynamodb tag-resource --resource-arn "$table_arn" --tags "${TAGS[@]}"
    echo "$table_arn"
}

echo "Verifying AWS identity for profile $AWS_PROFILE in $AWS_REGION..."
aws_cli sts get-caller-identity >/dev/null

echo "Creating or tagging DynamoDB Expense Report table..."
table_arn="$(create_or_tag_expense_report_table "$DYNAMODB_EXPENSE_REPORT_TABLE" "$DYNAMODB_EXPENSE_REPORT_TENANT_INDEX")"

echo "DynamoDB Expense Report table is ready: $table_arn"
