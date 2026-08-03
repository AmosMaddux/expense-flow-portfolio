import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import {
    glCode,
    glMapping,
    referenceDataAuditEntry,
} from "../db/schema/index.js";
import { NotFoundError } from "../errors/problem-json.js";
import type {
    GlCodeResponse,
    GlMappingReferenceResponse,
    GlMappingResponse,
} from "./glMappingDto.js";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type GlMappingAuditSnapshot = {
    category: string;
    glCodeId: string;
    accountCode: string;
    accountName: string;
};

/**
 * Reads tenant-scoped GL Mapping reference data for internal workspaces.
 */
export async function readGlMappingReference(
    tenantId: string,
    database: Database = db,
): Promise<GlMappingReferenceResponse> {
    const [mappings, glCodes] = await Promise.all([
        readTenantGlMappings(tenantId, database),
        readTenantGlCodes(tenantId, database),
    ]);

    return { mappings, glCodes };
}

/**
 * Updates one tenant-owned GL Mapping and appends a reference audit entry.
 */
export async function updateGlMapping(
    input: {
        actorId: string;
        glCodeId: string;
        id: string;
        tenantId: string;
    },
    database: Database = db,
): Promise<GlMappingResponse> {
    return database.transaction(async (transaction) => {
        const existing = await readTenantGlMappingById(
            input.tenantId,
            input.id,
            transaction,
        );
        const nextCode = await readTenantGlCodeById(
            input.tenantId,
            input.glCodeId,
            transaction,
        );
        const updatedAt = new Date();
        const [updated] = await transaction
            .update(glMapping)
            .set({ glCodeId: nextCode.id, updatedAt })
            .where(
                and(
                    eq(glMapping.tenantId, input.tenantId),
                    eq(glMapping.id, input.id),
                ),
            )
            .returning({ id: glMapping.id });

        if (updated === undefined) {
            throw new NotFoundError("GL Mapping was not found.");
        }

        await transaction.insert(referenceDataAuditEntry).values({
            tenantId: input.tenantId,
            actorId: input.actorId,
            entityType: "gl_mapping",
            entityId: input.id,
            action: "gl_mapping_updated",
            before: toAuditSnapshot(existing),
            after: toAuditSnapshot({
                ...existing,
                glCodeId: nextCode.id,
                accountCode: nextCode.accountCode,
                accountName: nextCode.accountName,
            }),
        });

        return {
            id: existing.id,
            category: existing.category,
            glCodeId: nextCode.id,
            accountCode: nextCode.accountCode,
            accountName: nextCode.accountName,
            description: nextCode.description,
            updatedAt: updatedAt.toISOString(),
        };
    });
}

async function readTenantGlMappings(
    tenantId: string,
    database: Database | Transaction,
): Promise<GlMappingResponse[]> {
    const rows = await database
        .select({
            id: glMapping.id,
            category: glMapping.category,
            glCodeId: glMapping.glCodeId,
            accountCode: glCode.accountCode,
            accountName: glCode.accountName,
            description: glCode.description,
            updatedAt: glMapping.updatedAt,
        })
        .from(glMapping)
        .innerJoin(
            glCode,
            and(
                eq(glCode.tenantId, glMapping.tenantId),
                eq(glCode.id, glMapping.glCodeId),
            ),
        )
        .where(eq(glMapping.tenantId, tenantId))
        .orderBy(asc(glMapping.category));

    return rows.map((row) => ({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
    }));
}

async function readTenantGlCodes(
    tenantId: string,
    database: Database | Transaction,
): Promise<GlCodeResponse[]> {
    return database
        .select({
            id: glCode.id,
            accountCode: glCode.accountCode,
            accountName: glCode.accountName,
            description: glCode.description,
        })
        .from(glCode)
        .where(eq(glCode.tenantId, tenantId))
        .orderBy(asc(glCode.accountCode));
}

async function readTenantGlMappingById(
    tenantId: string,
    id: string,
    database: Transaction,
): Promise<GlMappingResponse> {
    const [mapping] = await database
        .select({
            id: glMapping.id,
            category: glMapping.category,
            glCodeId: glMapping.glCodeId,
            updatedAt: glMapping.updatedAt,
        })
        .from(glMapping)
        .where(and(eq(glMapping.tenantId, tenantId), eq(glMapping.id, id)))
        .limit(1)
        .for("update");

    if (mapping === undefined) {
        throw new NotFoundError("GL Mapping was not found.");
    }

    const code = await readTenantGlCodeById(
        tenantId,
        mapping.glCodeId,
        database,
    );

    return {
        ...mapping,
        accountCode: code.accountCode,
        accountName: code.accountName,
        description: code.description,
        updatedAt: mapping.updatedAt.toISOString(),
    };
}

async function readTenantGlCodeById(
    tenantId: string,
    id: string,
    database: Database | Transaction,
): Promise<GlCodeResponse> {
    const [code] = await database
        .select({
            id: glCode.id,
            accountCode: glCode.accountCode,
            accountName: glCode.accountName,
            description: glCode.description,
        })
        .from(glCode)
        .where(and(eq(glCode.tenantId, tenantId), eq(glCode.id, id)))
        .limit(1);

    if (code === undefined) {
        throw new NotFoundError("GL Code was not found.");
    }

    return code;
}

function toAuditSnapshot(
    mapping: Pick<
        GlMappingResponse,
        "accountCode" | "accountName" | "category" | "glCodeId"
    >,
): GlMappingAuditSnapshot {
    return {
        category: mapping.category,
        glCodeId: mapping.glCodeId,
        accountCode: mapping.accountCode,
        accountName: mapping.accountName,
    };
}
