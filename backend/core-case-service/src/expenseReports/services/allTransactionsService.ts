import { db } from "../../db/client.js";
import { readAllTransactions as readPostgresAllTransactions } from "../../db/queries/allTransactions.js";
import {
    ReadAllTransactionsInboundRequestSchema,
    type AllTransaction,
    type ReadAllTransactionsParams,
} from "../../schemas/expense-report.schema.js";

export type AllTransactionsStore = {
    readAllTransactions(
        params: ReadAllTransactionsParams,
    ): Promise<AllTransaction[]>;
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
): Promise<AllTransaction[]> {
    const parsedRequest =
        ReadAllTransactionsInboundRequestSchema.parse(request);

    return dependencies.transactionStore.readAllTransactions(parsedRequest);
}
