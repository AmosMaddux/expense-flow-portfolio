import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";

import * as schema from "../db/schema/index.js";
import {
    glCode,
    glMapping,
    referenceDataAuditEntry,
} from "../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import { NotFoundError } from "../errors/problem-json.js";
import {
    readGlMappingReference,
    updateGlMapping,
} from "./glMappingRepository.js";

const tenantA = "00000000-0000-4000-8000-000000000a01";
const tenantB = "00000000-0000-4000-8000-000000000b01";
const actorId = "00000000-0000-4000-8000-000000000a02";
const mappingA = "00000000-0000-4000-8000-000000000a03";
const mappingB = "00000000-0000-4000-8000-000000000b03";
const travelCodeA = "00000000-0000-4000-8000-000000000a04";
const mealsCodeA = "00000000-0000-4000-8000-000000000a05";
const suppliesCodeA = "00000000-0000-4000-8000-000000000a06";
const travelCodeB = "00000000-0000-4000-8000-000000000b04";

let client: Client;
let secondClient: Client;
let testDb: NodePgDatabase<typeof schema>;
let secondTestDb: NodePgDatabase<typeof schema>;

describe("GL Mapping repository", () => {
    beforeAll(async () => {
        client = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        await client.connect();
        testDb = drizzle(client, { schema });
        secondClient = new Client({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });
        await secondClient.connect();
        secondTestDb = drizzle(secondClient, { schema });
    });

    afterAll(async () => {
        await secondClient.end().catch(() => undefined);
        await client.end().catch(() => undefined);
    });

    beforeEach(async () => {
        await client.query(
            'ALTER TABLE "reference_data_audit_entry" DISABLE TRIGGER "reference_data_audit_entry_prevent_mutation_trigger"',
        );
        try {
            await testDb.transaction(async (transaction) => {
                await transaction
                    .delete(referenceDataAuditEntry)
                    .where(eq(referenceDataAuditEntry.tenantId, tenantA));
                await transaction
                    .delete(referenceDataAuditEntry)
                    .where(eq(referenceDataAuditEntry.tenantId, tenantB));
                await transaction
                    .delete(glMapping)
                    .where(eq(glMapping.tenantId, tenantA));
                await transaction
                    .delete(glMapping)
                    .where(eq(glMapping.tenantId, tenantB));
                await transaction
                    .delete(glCode)
                    .where(eq(glCode.tenantId, tenantA));
                await transaction
                    .delete(glCode)
                    .where(eq(glCode.tenantId, tenantB));
                await seedGlReferenceRows(transaction);
            });
        } finally {
            await client.query(
                'ALTER TABLE "reference_data_audit_entry" ENABLE TRIGGER "reference_data_audit_entry_prevent_mutation_trigger"',
            );
        }
    });

    test("lists only the authenticated tenant's mappings and GL codes", async () => {
        const reference = await readGlMappingReference(tenantA, testDb);

        expect(reference.mappings).toHaveLength(1);
        expect(reference.mappings[0]).toMatchObject({
            id: mappingA,
            category: "Travel",
            glCodeId: travelCodeA,
            accountCode: "6100-A",
        });
        expect(reference.glCodes.map((code) => code.id).sort()).toStrictEqual([
            travelCodeA,
            mealsCodeA,
            suppliesCodeA,
        ]);
        expect(JSON.stringify(reference)).not.toContain(tenantB);
        expect(JSON.stringify(reference)).not.toContain("6100-B");
    });

    test("updates a tenant-owned mapping and writes one audit entry", async () => {
        const updated = await updateGlMapping(
            {
                actorId,
                glCodeId: mealsCodeA,
                id: mappingA,
                tenantId: tenantA,
            },
            testDb,
        );

        expect(updated).toMatchObject({
            id: mappingA,
            category: "Travel",
            glCodeId: mealsCodeA,
            accountCode: "6200-A",
            accountName: "Tenant A Meals Expense",
        });

        const [persistedMapping] = await testDb
            .select({ glCodeId: glMapping.glCodeId })
            .from(glMapping)
            .where(
                and(
                    eq(glMapping.tenantId, tenantA),
                    eq(glMapping.id, mappingA),
                ),
            );
        expect(persistedMapping).toStrictEqual({ glCodeId: mealsCodeA });

        const auditRows = await testDb
            .select({
                action: referenceDataAuditEntry.action,
                actorId: referenceDataAuditEntry.actorId,
                after: referenceDataAuditEntry.after,
                before: referenceDataAuditEntry.before,
                entityId: referenceDataAuditEntry.entityId,
                entityType: referenceDataAuditEntry.entityType,
                tenantId: referenceDataAuditEntry.tenantId,
            })
            .from(referenceDataAuditEntry)
            .where(eq(referenceDataAuditEntry.entityId, mappingA));

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: "gl_mapping_updated",
            actorId,
            entityId: mappingA,
            entityType: "gl_mapping",
            tenantId: tenantA,
        });
        expect(auditRows[0]?.before).toStrictEqual({
            category: "Travel",
            glCodeId: travelCodeA,
            accountCode: "6100-A",
            accountName: "Tenant A Travel Expense",
        });
        expect(auditRows[0]?.after).toStrictEqual({
            category: "Travel",
            glCodeId: mealsCodeA,
            accountCode: "6200-A",
            accountName: "Tenant A Meals Expense",
        });
    });

    test("rejects cross-tenant mappings and cross-tenant GL codes", async () => {
        await expect(
            updateGlMapping(
                {
                    actorId,
                    glCodeId: mealsCodeA,
                    id: mappingB,
                    tenantId: tenantA,
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);

        await expect(
            updateGlMapping(
                {
                    actorId,
                    glCodeId: travelCodeB,
                    id: mappingA,
                    tenantId: tenantA,
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);

        const [mapping] = await testDb
            .select({ glCodeId: glMapping.glCodeId })
            .from(glMapping)
            .where(
                and(
                    eq(glMapping.tenantId, tenantA),
                    eq(glMapping.id, mappingA),
                ),
            );
        expect(mapping).toStrictEqual({ glCodeId: travelCodeA });
    });

    test("serializes concurrent updates so audit before matches the prior committed after", async () => {
        await Promise.all([
            updateGlMapping(
                {
                    actorId,
                    glCodeId: mealsCodeA,
                    id: mappingA,
                    tenantId: tenantA,
                },
                testDb,
            ),
            updateGlMapping(
                {
                    actorId,
                    glCodeId: suppliesCodeA,
                    id: mappingA,
                    tenantId: tenantA,
                },
                secondTestDb,
            ),
        ]);

        const auditRows = await testDb
            .select({
                after: referenceDataAuditEntry.after,
                before: referenceDataAuditEntry.before,
            })
            .from(referenceDataAuditEntry)
            .where(eq(referenceDataAuditEntry.entityId, mappingA));
        const firstAudit = auditRows.find(
            (row) =>
                isAuditSnapshot(row.before, travelCodeA) &&
                (isAuditSnapshot(row.after, mealsCodeA) ||
                    isAuditSnapshot(row.after, suppliesCodeA)),
        );
        const secondAudit = auditRows.find(
            (row) =>
                firstAudit !== undefined &&
                JSON.stringify(row.before) === JSON.stringify(firstAudit.after),
        );

        expect(auditRows).toHaveLength(2);
        expect(firstAudit).toBeDefined();
        expect(secondAudit).toBeDefined();
    });
    test("rolls back the mapping update when audit insertion fails", async () => {
        await expect(
            updateGlMapping(
                {
                    actorId: "not-a-uuid",
                    glCodeId: mealsCodeA,
                    id: mappingA,
                    tenantId: tenantA,
                },
                testDb,
            ),
        ).rejects.toThrow();

        const [mapping] = await testDb
            .select({ glCodeId: glMapping.glCodeId })
            .from(glMapping)
            .where(
                and(
                    eq(glMapping.tenantId, tenantA),
                    eq(glMapping.id, mappingA),
                ),
            );
        const auditRows = await testDb
            .select({ id: referenceDataAuditEntry.id })
            .from(referenceDataAuditEntry)
            .where(eq(referenceDataAuditEntry.entityId, mappingA));

        expect(mapping).toStrictEqual({ glCodeId: travelCodeA });
        expect(auditRows).toHaveLength(0);
    });
});

type Transaction = Parameters<Parameters<typeof testDb.transaction>[0]>[0];

async function seedGlReferenceRows(transaction: Transaction): Promise<void> {
    await transaction.insert(glCode).values([
        {
            id: travelCodeA,
            tenantId: tenantA,
            accountCode: "6100-A",
            accountName: "Tenant A Travel Expense",
        },
        {
            id: mealsCodeA,
            tenantId: tenantA,
            accountCode: "6200-A",
            accountName: "Tenant A Meals Expense",
        },
        {
            id: suppliesCodeA,
            tenantId: tenantA,
            accountCode: "6300-A",
            accountName: "Tenant A Supplies Expense",
        },
        {
            id: travelCodeB,
            tenantId: tenantB,
            accountCode: "6100-B",
            accountName: "Tenant B Travel Expense",
        },
    ]);
    await transaction.insert(glMapping).values([
        {
            id: mappingA,
            tenantId: tenantA,
            category: "Travel",
            glCodeId: travelCodeA,
        },
        {
            id: mappingB,
            tenantId: tenantB,
            category: "Travel",
            glCodeId: travelCodeB,
        },
    ]);
}

function isAuditSnapshot(value: unknown, glCodeId: string): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        "glCodeId" in value &&
        value.glCodeId === glCodeId
    );
}
