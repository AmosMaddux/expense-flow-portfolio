import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import {
    afterAll,
    afterEach,
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

type GlMappingTestContext = {
    tenantA: string;
    tenantB: string;
    actorId: string;
    mappingA: string;
    mappingB: string;
    travelCodeA: string;
    mealsCodeA: string;
    suppliesCodeA: string;
    travelCodeB: string;
};

let client: Client;
let secondClient: Client;
let testDb: NodePgDatabase<typeof schema>;
let secondTestDb: NodePgDatabase<typeof schema>;
let context: GlMappingTestContext;

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
        context = createGlMappingTestContext();
        await testDb.transaction(async (transaction) => {
            await seedGlReferenceRows(transaction, context);
        });
    });

    afterEach(async () => {
        await testDb.transaction(async (transaction) => {
            await transaction
                .delete(glMapping)
                .where(eq(glMapping.tenantId, context.tenantA));
            await transaction
                .delete(glMapping)
                .where(eq(glMapping.tenantId, context.tenantB));
            await transaction
                .delete(glCode)
                .where(eq(glCode.tenantId, context.tenantA));
            await transaction
                .delete(glCode)
                .where(eq(glCode.tenantId, context.tenantB));
        });
    });

    test("lists only the authenticated tenant's mappings and GL codes", async () => {
        const reference = await readGlMappingReference(context.tenantA, testDb);

        expect(reference.mappings).toHaveLength(1);
        expect(reference.mappings[0]).toMatchObject({
            id: context.mappingA,
            category: "Travel",
            glCodeId: context.travelCodeA,
            accountCode: "6100-A",
        });
        expect(reference.glCodes.map((code) => code.id).sort()).toStrictEqual(
            [
                context.travelCodeA,
                context.mealsCodeA,
                context.suppliesCodeA,
            ].sort(),
        );
        expect(JSON.stringify(reference)).not.toContain(context.tenantB);
        expect(JSON.stringify(reference)).not.toContain("6100-B");
    });

    test("updates a tenant-owned mapping and writes one audit entry", async () => {
        const updated = await updateGlMapping(
            {
                actorId: context.actorId,
                glCodeId: context.mealsCodeA,
                id: context.mappingA,
                tenantId: context.tenantA,
            },
            testDb,
        );

        expect(updated).toMatchObject({
            id: context.mappingA,
            category: "Travel",
            glCodeId: context.mealsCodeA,
            accountCode: "6200-A",
            accountName: "Tenant A Meals Expense",
        });

        const [persistedMapping] = await testDb
            .select({ glCodeId: glMapping.glCodeId })
            .from(glMapping)
            .where(
                and(
                    eq(glMapping.tenantId, context.tenantA),
                    eq(glMapping.id, context.mappingA),
                ),
            );
        expect(persistedMapping).toStrictEqual({
            glCodeId: context.mealsCodeA,
        });

        const auditRows = await readAuditRows(context.mappingA);

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: "gl_mapping_updated",
            actorId: context.actorId,
            entityId: context.mappingA,
            entityType: "gl_mapping",
            tenantId: context.tenantA,
        });
        expect(auditRows[0]?.before).toStrictEqual({
            category: "Travel",
            glCodeId: context.travelCodeA,
            accountCode: "6100-A",
            accountName: "Tenant A Travel Expense",
        });
        expect(auditRows[0]?.after).toStrictEqual({
            category: "Travel",
            glCodeId: context.mealsCodeA,
            accountCode: "6200-A",
            accountName: "Tenant A Meals Expense",
        });
    });

    test("returns the existing mapping without auditing no-op updates", async () => {
        const existing = await updateGlMapping(
            {
                actorId: context.actorId,
                glCodeId: context.travelCodeA,
                id: context.mappingA,
                tenantId: context.tenantA,
            },
            testDb,
        );

        expect(existing).toMatchObject({
            id: context.mappingA,
            category: "Travel",
            glCodeId: context.travelCodeA,
            accountCode: "6100-A",
            accountName: "Tenant A Travel Expense",
        });
        await expect(readAuditRows(context.mappingA)).resolves.toHaveLength(0);
    });

    test("rejects cross-tenant mappings and cross-tenant GL codes", async () => {
        await expect(
            updateGlMapping(
                {
                    actorId: context.actorId,
                    glCodeId: context.mealsCodeA,
                    id: context.mappingB,
                    tenantId: context.tenantA,
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);

        await expect(
            updateGlMapping(
                {
                    actorId: context.actorId,
                    glCodeId: context.travelCodeB,
                    id: context.mappingA,
                    tenantId: context.tenantA,
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);

        const [mapping] = await testDb
            .select({ glCodeId: glMapping.glCodeId })
            .from(glMapping)
            .where(
                and(
                    eq(glMapping.tenantId, context.tenantA),
                    eq(glMapping.id, context.mappingA),
                ),
            );
        expect(mapping).toStrictEqual({ glCodeId: context.travelCodeA });
    });

    test("serializes concurrent updates so audit before matches the prior committed after", async () => {
        await Promise.all([
            updateGlMapping(
                {
                    actorId: context.actorId,
                    glCodeId: context.mealsCodeA,
                    id: context.mappingA,
                    tenantId: context.tenantA,
                },
                testDb,
            ),
            updateGlMapping(
                {
                    actorId: context.actorId,
                    glCodeId: context.suppliesCodeA,
                    id: context.mappingA,
                    tenantId: context.tenantA,
                },
                secondTestDb,
            ),
        ]);

        const auditRows = await readAuditRows(context.mappingA);
        const firstAudit = auditRows.find(
            (row) =>
                isAuditSnapshot(row.before, context.travelCodeA) &&
                (isAuditSnapshot(row.after, context.mealsCodeA) ||
                    isAuditSnapshot(row.after, context.suppliesCodeA)),
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
                    glCodeId: context.mealsCodeA,
                    id: context.mappingA,
                    tenantId: context.tenantA,
                },
                testDb,
            ),
        ).rejects.toThrow();

        const [mapping] = await testDb
            .select({ glCodeId: glMapping.glCodeId })
            .from(glMapping)
            .where(
                and(
                    eq(glMapping.tenantId, context.tenantA),
                    eq(glMapping.id, context.mappingA),
                ),
            );
        const auditRows = await readAuditRows(context.mappingA);

        expect(mapping).toStrictEqual({ glCodeId: context.travelCodeA });
        expect(auditRows).toHaveLength(0);
    });
});

type Transaction = Parameters<Parameters<typeof testDb.transaction>[0]>[0];

function createGlMappingTestContext(): GlMappingTestContext {
    return {
        tenantA: randomUUID(),
        tenantB: randomUUID(),
        actorId: randomUUID(),
        mappingA: randomUUID(),
        mappingB: randomUUID(),
        travelCodeA: randomUUID(),
        mealsCodeA: randomUUID(),
        suppliesCodeA: randomUUID(),
        travelCodeB: randomUUID(),
    };
}

async function seedGlReferenceRows(
    transaction: Transaction,
    testContext: GlMappingTestContext,
): Promise<void> {
    await transaction.insert(glCode).values([
        {
            id: testContext.travelCodeA,
            tenantId: testContext.tenantA,
            accountCode: "6100-A",
            accountName: "Tenant A Travel Expense",
        },
        {
            id: testContext.mealsCodeA,
            tenantId: testContext.tenantA,
            accountCode: "6200-A",
            accountName: "Tenant A Meals Expense",
        },
        {
            id: testContext.suppliesCodeA,
            tenantId: testContext.tenantA,
            accountCode: "6300-A",
            accountName: "Tenant A Supplies Expense",
        },
        {
            id: testContext.travelCodeB,
            tenantId: testContext.tenantB,
            accountCode: "6100-B",
            accountName: "Tenant B Travel Expense",
        },
    ]);
    await transaction.insert(glMapping).values([
        {
            id: testContext.mappingA,
            tenantId: testContext.tenantA,
            category: "Travel",
            glCodeId: testContext.travelCodeA,
        },
        {
            id: testContext.mappingB,
            tenantId: testContext.tenantB,
            category: "Travel",
            glCodeId: testContext.travelCodeB,
        },
    ]);
}

async function readAuditRows(entityId: string) {
    return testDb
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
        .where(eq(referenceDataAuditEntry.entityId, entityId));
}

function isAuditSnapshot(value: unknown, glCodeId: string): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        "glCodeId" in value &&
        value.glCodeId === glCodeId
    );
}
