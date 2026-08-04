import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { tenantExpensePolicy } from "../db/schema/index.js";

export type TenantExpensePolicyRecord = {
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
            policyText: tenantExpensePolicy.policyText,
            updatedAt: tenantExpensePolicy.updatedAt,
        })
        .from(tenantExpensePolicy)
        .where(eq(tenantExpensePolicy.tenantId, tenantId))
        .limit(1);

    return policy ?? null;
}
