import { asc, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import { user } from "../db/schema/index.js";
import type { TenantSummary } from "./platformAdminDto.js";

type Database = NodePgDatabase<typeof schema>;

/**
 * Reads a user-count summary for every tenant that has at least one user.
 * Deliberately not scoped to the caller's own tenant: this is the one
 * platform-level read that must see across tenants so a Platform Admin can
 * administer the platform without impersonating a tenant. It returns only
 * aggregate counts, never a tenant's case data or user detail rows.
 */
export async function readTenantSummaries(
    database: Database = db,
): Promise<TenantSummary[]> {
    const rows = await database
        .select({
            tenantId: user.tenantId,
            userCount: sql<number>`count(*)`.mapWith(Number),
            activeUserCount:
                sql<number>`count(*) filter (where ${user.status} = 'active')`.mapWith(
                    Number,
                ),
            invitedUserCount:
                sql<number>`count(*) filter (where ${user.status} = 'invited')`.mapWith(
                    Number,
                ),
            deactivatedUserCount:
                sql<number>`count(*) filter (where ${user.status} = 'deactivated')`.mapWith(
                    Number,
                ),
        })
        .from(user)
        .groupBy(user.tenantId)
        .orderBy(asc(user.tenantId));

    return rows;
}
