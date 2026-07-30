import { db } from "../../db/client.js";
import { readAllTransactions as readPostgresAllTransactions } from "../../db/queries/allTransactions.js";
import {
    ReadAllTransactionsInboundRequestSchema,
    type AllTransaction,
    type AllTransactionPage,
    type ParsedReadAllTransactionsParams,
    type ReadAllTransactionsParams,
} from "../../schemas/expense-report.schema.js";

export type AllTransactionsStore = {
    readAllTransactions(
        params: ParsedReadAllTransactionsParams,
    ): Promise<AllTransactionPage>;
};

export type AllTransactionsServiceDependencies = {
    now?: () => Date;
    transactionStore: AllTransactionsStore;
};

/**
 * Reads tenant-scoped line items for the All Transactions workspace.
 */
export async function readTenantAllTransactions(
    request: ReadAllTransactionsParams,
    dependencies: AllTransactionsServiceDependencies = {
        transactionStore: {
            readAllTransactions: (params) =>
                readPostgresAllTransactions(db, params),
        },
    },
): Promise<AllTransactionPage> {
    const parsedRequest =
        ReadAllTransactionsInboundRequestSchema.parse(request);
    const page =
        await dependencies.transactionStore.readAllTransactions(parsedRequest);
    const today = toUtcDate(dependencies.now?.() ?? new Date());

    return {
        ...page,
        items: page.items.map((transaction) =>
            withServiceComputedOverdue(transaction, today),
        ),
    };
}

function withServiceComputedOverdue(
    transaction: AllTransaction,
    today: string,
): AllTransaction {
    return {
        ...transaction,
        isOverdue:
            transaction.status !== "Reconciled" && transaction.dueDate < today,
    };
}

function toUtcDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}
