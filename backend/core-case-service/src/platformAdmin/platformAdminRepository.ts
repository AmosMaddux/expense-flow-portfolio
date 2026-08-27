import { asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import { referenceDataAuditEntry, user } from "../db/schema/index.js";
import type { AuditLogEntry, TenantSummary } from "./platformAdminDto.js";

type Database = NodePgDatabase<typeof schema>;

// Caps how far back a single read reaches; the screen shows recent
// administrative activity, not a full historical export.
const auditLogEventLimit = 200;

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

/**
 * Reads the most recent cross-tenant administrative audit events for the
 * Platform Admin Audit Log screen. Deliberately not scoped to the caller's
 * own tenant, same as readTenantSummaries. Returns only actor, action, and
 * entity metadata for reference-data changes (user and GL mapping
 * administration) — never a tenant's case content.
 */
export async function readAuditLogEvents(
    database: Database = db,
): Promise<AuditLogEntry[]> {
    const rows = await database
        .select({
            id: referenceDataAuditEntry.id,
            tenantId: referenceDataAuditEntry.tenantId,
            actorId: referenceDataAuditEntry.actorId,
            actorEmail: user.email,
            actorDisplayName: user.displayName,
            entityType: referenceDataAuditEntry.entityType,
            entityId: referenceDataAuditEntry.entityId,
            action: referenceDataAuditEntry.action,
            occurredAt: referenceDataAuditEntry.createdAt,
        })
        .from(referenceDataAuditEntry)
        .leftJoin(user, eq(user.id, referenceDataAuditEntry.actorId))
        .orderBy(desc(referenceDataAuditEntry.createdAt))
        .limit(auditLogEventLimit);

    return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        actor: {
            id: row.actorId,
            email: row.actorEmail,
            displayName: row.actorDisplayName,
        },
        entityType: parseAuditEntityType(row.entityType),
        entityId: row.entityId,
        action: parseAuditAction(row.action),
        occurredAt: row.occurredAt.toISOString(),
    }));
}

function parseAuditEntityType(value: string): AuditLogEntry["entityType"] {
    if (value === "gl_mapping" || value === "user") {
        return value;
    }

    throw new Error(`Unexpected audit entity type value: ${value}`);
}

function parseAuditAction(value: string): AuditLogEntry["action"] {
    if (
        value === "gl_mapping_updated" ||
        value === "user_invited" ||
        value === "user_role_changed" ||
        value === "user_status_changed"
    ) {
        return value;
    }

    throw new Error(`Unexpected audit action value: ${value}`);
}
