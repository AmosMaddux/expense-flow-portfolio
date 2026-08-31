import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import { referenceDataAuditEntry, user } from "../db/schema/index.js";
import {
    AuditLogActionSchema,
    AuditLogCursorSchema,
    AuditLogEntityTypeSchema,
} from "./platformAdminDto.js";
import type {
    AuditLogEntry,
    AuditLogEntryPageResponse,
    TenantSummary,
} from "./platformAdminDto.js";

type Database = NodePgDatabase<typeof schema>;

type AuditLogCursor = {
    createdAt: Date;
    id: string;
};

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
 * Reads one keyset-paginated page of cross-tenant administrative audit
 * events for the Platform Admin Audit Log screen. Deliberately not scoped to
 * the caller's own tenant, same as readTenantSummaries. Returns only actor,
 * action, and entity metadata for reference-data changes (user and GL
 * mapping administration) — never a tenant's case content. Ordered by
 * (created_at, id) descending, backed by
 * reference_data_audit_entry_created_at_id_idx, with id as a tiebreaker so
 * rows sharing a created_at timestamp still get a stable, gap-free cursor.
 */
export async function readAuditLogEvents(
    request: { cursor?: string | undefined; pageSize: number },
    database: Database = db,
): Promise<AuditLogEntryPageResponse> {
    const cursor =
        request.cursor === undefined
            ? undefined
            : decodeAuditLogCursor(request.cursor);
    const cursorCondition =
        cursor === undefined
            ? undefined
            : or(
                  lt(referenceDataAuditEntry.createdAt, cursor.createdAt),
                  and(
                      eq(referenceDataAuditEntry.createdAt, cursor.createdAt),
                      lt(referenceDataAuditEntry.id, cursor.id),
                  ),
              );

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
            createdAt: referenceDataAuditEntry.createdAt,
        })
        .from(referenceDataAuditEntry)
        .leftJoin(user, eq(user.id, referenceDataAuditEntry.actorId))
        .where(and(cursorCondition))
        .orderBy(
            desc(referenceDataAuditEntry.createdAt),
            desc(referenceDataAuditEntry.id),
        )
        .limit(request.pageSize + 1);

    const hasNextPage = rows.length > request.pageSize;
    const pageRows = rows.slice(0, request.pageSize);
    const lastRow = pageRows.at(-1);

    return {
        events: pageRows.map(toAuditLogEntry),
        nextCursor:
            hasNextPage && lastRow !== undefined
                ? encodeAuditLogCursor(lastRow)
                : null,
    };
}

function toAuditLogEntry(row: {
    id: string;
    tenantId: string;
    actorId: string;
    actorEmail: string | null;
    actorDisplayName: string | null;
    entityType: string;
    entityId: string;
    action: string;
    createdAt: Date;
}): AuditLogEntry {
    return {
        id: row.id,
        tenantId: row.tenantId,
        actor: {
            id: row.actorId,
            email: row.actorEmail,
            displayName: row.actorDisplayName,
        },
        entityType: AuditLogEntityTypeSchema.parse(row.entityType),
        entityId: row.entityId,
        action: AuditLogActionSchema.parse(row.action),
        occurredAt: row.createdAt.toISOString(),
    };
}

function encodeAuditLogCursor(row: { createdAt: Date; id: string }): string {
    return Buffer.from(
        [row.createdAt.toISOString(), row.id].join("|"),
        "utf8",
    ).toString("base64url");
}

function decodeAuditLogCursor(cursor: string): AuditLogCursor {
    const [createdAt, id] = Buffer.from(cursor, "base64url")
        .toString("utf8")
        .split("|");
    const parsed = AuditLogCursorSchema.parse({ createdAt, id });

    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
}
