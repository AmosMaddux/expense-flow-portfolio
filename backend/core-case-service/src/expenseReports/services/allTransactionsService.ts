import { db } from "../../db/client.js";
import { readAllTransactions as readPostgresAllTransactions } from "../../db/queries/allTransactions.js";
import {
    ReadAllTransactionsInboundRequestSchema,
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

    return dependencies.transactionStore.readAllTransactions(parsedRequest);
}
