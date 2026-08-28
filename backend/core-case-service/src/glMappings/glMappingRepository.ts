import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import {
    glCode,
    glMapping,
    referenceDataAuditEntry,
} from "../db/schema/index.js";
import { ConflictError, NotFoundError } from "../errors/problem-json.js";
import type {
    GlCodeResponse,
    GlMappingReferenceResponse,
    GlMappingResponse,
    SaveGlMappingsRequest,
} from "./glMappingDto.js";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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
 * Applies a page-full of GL Mapping creates, edits, and deletes atomically.
 * Each mapping owns a private GL account row, so edits never affect any
 * other mapping even if two mappings once shared the same account code.
 */
export async function saveGlMappings(
    input: {
        actorId: string;
        tenantId: string;
    } & SaveGlMappingsRequest,
    database: Database = db,
): Promise<GlMappingReferenceResponse> {
    return database.transaction(async (transaction) => {
        const existingMappings = await transaction
            .select({
                id: glMapping.id,
                category: glMapping.category,
                glCodeId: glMapping.glCodeId,
            })
            .from(glMapping)
            .where(eq(glMapping.tenantId, input.tenantId))
            .for("update");
        const existingById = new Map(
            existingMappings.map((mapping) => [mapping.id, mapping]),
        );

        const deleteIds = new Set(input.deletes);
        for (const deleteId of deleteIds) {
            if (!existingById.has(deleteId)) {
                throw new NotFoundError(
                    `GL Mapping ${deleteId} was not found.`,
                );
            }
        }
        for (const update of input.updates) {
            if (!existingById.has(update.id)) {
                throw new NotFoundError(
                    `GL Mapping ${update.id} was not found.`,
                );
            }
            if (deleteIds.has(update.id)) {
                throw new ConflictError(
                    `GL Mapping ${update.id} cannot be both updated and deleted in the same save.`,
                );
            }
        }

        const categoryById = new Map(
            input.updates.map((update) => [update.id, update.category]),
        );
        const ownerIdsByCategory = new Map<string, string[]>();
        const addCategoryOwner = (category: string, ownerId: string) => {
            const owners = ownerIdsByCategory.get(category) ?? [];
            owners.push(ownerId);
            ownerIdsByCategory.set(category, owners);
        };
        for (const mapping of existingMappings) {
            if (!deleteIds.has(mapping.id)) {
                addCategoryOwner(
                    categoryById.get(mapping.id) ?? mapping.category,
                    mapping.id,
                );
            }
        }
        for (const create of input.creates) {
            addCategoryOwner(create.category, `new:${create.clientId}`);
        }

        const duplicateCategory = [...ownerIdsByCategory.entries()].find(
            ([, owners]) => owners.length > 1,
        );
        if (duplicateCategory !== undefined) {
            throw new ConflictError(
                `GL Mapping category "${duplicateCategory[0]}" is used more than once.`,
            );
        }

        if (deleteIds.size > 0) {
            await transaction
                .delete(glMapping)
                .where(
                    and(
                        eq(glMapping.tenantId, input.tenantId),
                        inArray(glMapping.id, [...deleteIds]),
                    ),
                );
            for (const deleteId of deleteIds) {
                const deleted = existingById.get(deleteId);
                if (deleted !== undefined) {
                    await transaction.insert(referenceDataAuditEntry).values({
                        tenantId: input.tenantId,
                        actorId: input.actorId,
                        entityType: "gl_mapping",
                        entityId: deleteId,
                        action: "gl_mapping_deleted",
                        before: { category: deleted.category },
                        after: {},
                    });
                }
            }
        }

        for (const update of input.updates) {
            const existing = existingById.get(update.id);
            if (existing === undefined) {
                continue;
            }
            const updatedAt = new Date();
            await transaction
                .update(glCode)
                .set({
                    accountCode: update.accountCode,
                    accountName: update.category,
                    description: update.description,
                    updatedAt,
                })
                .where(
                    and(
                        eq(glCode.tenantId, input.tenantId),
                        eq(glCode.id, existing.glCodeId),
                    ),
                );
            await transaction
                .update(glMapping)
                .set({ category: update.category, updatedAt })
                .where(
                    and(
                        eq(glMapping.tenantId, input.tenantId),
                        eq(glMapping.id, update.id),
                    ),
                );
            await transaction.insert(referenceDataAuditEntry).values({
                tenantId: input.tenantId,
                actorId: input.actorId,
                entityType: "gl_mapping",
                entityId: update.id,
                action: "gl_mapping_updated",
                before: { category: existing.category },
                after: {
                    category: update.category,
                    accountCode: update.accountCode,
                },
            });
        }

        for (const create of input.creates) {
            const [createdCode] = await transaction
                .insert(glCode)
                .values({
                    tenantId: input.tenantId,
                    accountCode: create.accountCode,
                    accountName: create.category,
                    description: create.description,
                })
                .returning({ id: glCode.id });

            if (createdCode === undefined) {
                throw new ConflictError(
                    `GL Mapping "${create.category}" could not be created.`,
                );
            }

            const [createdMapping] = await transaction
                .insert(glMapping)
                .values({
                    tenantId: input.tenantId,
                    category: create.category,
                    glCodeId: createdCode.id,
                })
                .returning({ id: glMapping.id });

            if (createdMapping === undefined) {
                throw new ConflictError(
                    `GL Mapping "${create.category}" could not be created.`,
                );
            }

            await transaction.insert(referenceDataAuditEntry).values({
                tenantId: input.tenantId,
                actorId: input.actorId,
                entityType: "gl_mapping",
                entityId: createdMapping.id,
                action: "gl_mapping_created",
                before: {},
                after: {
                    category: create.category,
                    accountCode: create.accountCode,
                },
            });
        }

        const [mappings, glCodes] = await Promise.all([
            readTenantGlMappings(input.tenantId, transaction),
            readTenantGlCodes(input.tenantId, transaction),
        ]);

        return { mappings, glCodes };
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
