import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import {
    tenantExpensePolicy,
    type TenantExpensePolicyChunk,
} from "../db/schema/index.js";

export type TenantExpensePolicyRecord = {
    tenantId: string;
    policyText: string;
    updatedAt: Date;
};

/**
 * Reads the expense policy configured for one authenticated tenant.
 */
export async function findTenantExpensePolicy(
    tenantId: string,
): Promise<TenantExpensePolicyRecord | null> {
    const [policy] = await db
        .select({
            tenantId: tenantExpensePolicy.tenantId,
            policyText: tenantExpensePolicy.policyText,
            updatedAt: tenantExpensePolicy.updatedAt,
        })
        .from(tenantExpensePolicy)
        .where(eq(tenantExpensePolicy.tenantId, tenantId))
        .limit(1);

    return policy ?? null;
}

/**
 * Reads all tenant policies available for corpus loading.
 */
export async function findTenantPoliciesForCorpusLoad(): Promise<
    TenantExpensePolicyRecord[]
> {
    return db
        .select({
            tenantId: tenantExpensePolicy.tenantId,
            policyText: tenantExpensePolicy.policyText,
            updatedAt: tenantExpensePolicy.updatedAt,
        })
        .from(tenantExpensePolicy);
}

export type TenantExpensePolicyChunkRecord = TenantExpensePolicyChunk;
