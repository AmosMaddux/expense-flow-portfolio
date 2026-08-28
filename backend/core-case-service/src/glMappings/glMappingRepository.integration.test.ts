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
import { ConflictError, NotFoundError } from "../errors/problem-json.js";
import {
    readGlMappingReference,
    saveGlMappings,
} from "./glMappingRepository.js";

type GlMappingTestContext = {
    tenantA: string;
    tenantB: string;
    actorId: string;
    mappingA: string;
    mappingB: string;
    mealsCodeAMappingId: string;
    suppliesCodeAMappingId: string;
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

const emptySave = { creates: [], updates: [], deletes: [] };

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

        expect(reference.mappings).toHaveLength(3);
        expect(
            reference.mappings.find(
                (mapping) => mapping.id === context.mappingA,
            ),
        ).toMatchObject({
            id: context.mappingA,
            category: "Travel",
            glCodeId: context.travelCodeA,
            accountCode: "6100",
        });
        expect(reference.glCodes.map((code) => code.id).sort()).toStrictEqual(
            [
                context.travelCodeA,
                context.mealsCodeA,
                context.suppliesCodeA,
            ].sort(),
        );
        expect(JSON.stringify(reference)).not.toContain(context.tenantB);
        expect(JSON.stringify(reference)).not.toContain("6199");
    });

    test("creates a new mapping with its own private GL code and writes one audit entry", async () => {
        const saved = await saveGlMappings(
            {
                actorId: context.actorId,
                tenantId: context.tenantA,
                creates: [
                    {
                        clientId: "draft-1",
                        category: "Parking",
                        accountCode: "6700",
                        description: "Synthetic parking account",
                    },
                ],
                updates: [],
                deletes: [],
            },
            testDb,
        );

        const created = saved.mappings.find(
            (mapping) => mapping.category === "Parking",
        );
        expect(created).toMatchObject({
            category: "Parking",
            accountCode: "6700",
            accountName: "Parking",
            description: "Synthetic parking account",
        });
        expect(saved.mappings).toHaveLength(4);

        const auditRows = await readAuditRows(created?.id ?? "");
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: "gl_mapping_created",
            actorId: context.actorId,
            tenantId: context.tenantA,
        });
    });

    test("updates a tenant-owned mapping's own GL code without touching other mappings", async () => {
        const saved = await saveGlMappings(
            {
                actorId: context.actorId,
                tenantId: context.tenantA,
                creates: [],
                updates: [
                    {
                        id: context.mappingA,
                        category: "Travel",
                        accountCode: "6150",
                        description: "Updated travel account",
                    },
                ],
                deletes: [],
            },
            testDb,
        );

        const updated = saved.mappings.find(
            (mapping) => mapping.id === context.mappingA,
        );
        expect(updated).toMatchObject({
            id: context.mappingA,
            category: "Travel",
            glCodeId: context.travelCodeA,
            accountCode: "6150",
            accountName: "Travel",
            description: "Updated travel account",
        });

        const otherCode = saved.glCodes.find(
            (code) => code.id === context.mealsCodeA,
        );
        expect(otherCode).toMatchObject({ accountCode: "6200" });

        const auditRows = await readAuditRows(context.mappingA);
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: "gl_mapping_updated",
            actorId: context.actorId,
            tenantId: context.tenantA,
        });
        expect(auditRows[0]?.before).toStrictEqual({ category: "Travel" });
        expect(auditRows[0]?.after).toStrictEqual({
            category: "Travel",
            accountCode: "6150",
        });
    });

    test("deletes a mapping, including a default mapping, and writes one audit entry", async () => {
        const saved = await saveGlMappings(
            {
                actorId: context.actorId,
                tenantId: context.tenantA,
                creates: [],
                updates: [],
                deletes: [context.mappingA],
            },
            testDb,
        );

        expect(
            saved.mappings.some((mapping) => mapping.id === context.mappingA),
        ).toBe(false);

        const [persistedMapping] = await testDb
            .select({ id: glMapping.id })
            .from(glMapping)
            .where(eq(glMapping.id, context.mappingA));
        expect(persistedMapping).toBeUndefined();

        const auditRows = await readAuditRows(context.mappingA);
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            action: "gl_mapping_deleted",
            actorId: context.actorId,
            tenantId: context.tenantA,
        });
    });

    test("applies creates, updates, and deletes atomically in one save", async () => {
        const saved = await saveGlMappings(
            {
                actorId: context.actorId,
                tenantId: context.tenantA,
                creates: [
                    {
                        clientId: "draft-1",
                        category: "Parking",
                        accountCode: "6700",
                        description: null,
                    },
                ],
                updates: [
                    {
                        id: context.mealsCodeAMappingId,
                        category: "Meals",
                        accountCode: "6250",
                        description: null,
                    },
                ],
                deletes: [context.suppliesCodeAMappingId],
            },
            testDb,
        );

        const categories = saved.mappings.map((mapping) => mapping.category).sort();
        expect(categories).toStrictEqual(["Meals", "Parking", "Travel"]);
    });

    test("rejects a save that would create a duplicate category", async () => {
        await expect(
            saveGlMappings(
                {
                    actorId: context.actorId,
                    tenantId: context.tenantA,
                    creates: [
                        {
                            clientId: "draft-1",
                            category: "Travel",
                            accountCode: "6800",
                            description: null,
                        },
                    ],
                    updates: [],
                    deletes: [],
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(ConflictError);

        const reference = await readGlMappingReference(context.tenantA, testDb);
        expect(reference.mappings).toHaveLength(3);
    });

    test("rejects updates and deletes for mappings outside the tenant", async () => {
        await expect(
            saveGlMappings(
                {
                    actorId: context.actorId,
                    tenantId: context.tenantA,
                    creates: [],
                    updates: [
                        {
                            id: context.mappingB,
                            category: "Travel",
                            accountCode: "6999",
                            description: null,
                        },
                    ],
                    deletes: [],
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);

        await expect(
            saveGlMappings(
                {
                    actorId: context.actorId,
                    tenantId: context.tenantA,
                    creates: [],
                    updates: [],
                    deletes: [context.mappingB],
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

    test("rolls back the entire save when one change in the batch is invalid", async () => {
        await expect(
            saveGlMappings(
                {
                    actorId: context.actorId,
                    tenantId: context.tenantA,
                    creates: [
                        {
                            clientId: "draft-1",
                            category: "Parking",
                            accountCode: "6700",
                            description: null,
                        },
                    ],
                    updates: [
                        {
                            id: context.mappingB,
                            category: "Travel",
                            accountCode: "6999",
                            description: null,
                        },
                    ],
                    deletes: [],
                },
                testDb,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);

        const reference = await readGlMappingReference(context.tenantA, testDb);
        expect(reference.mappings).toHaveLength(3);
        expect(
            reference.mappings.some((mapping) => mapping.category === "Parking"),
        ).toBe(false);
    });

    test("serializes concurrent saves so audit before matches the prior committed after", async () => {
        await Promise.all([
            saveGlMappings(
                {
                    actorId: context.actorId,
                    tenantId: context.tenantA,
                    creates: [],
                    updates: [
                        {
                            id: context.mappingA,
                            category: "Travel",
                            accountCode: "6151",
                            description: null,
                        },
                    ],
                    deletes: [],
                },
                testDb,
            ),
            saveGlMappings(
                {
                    actorId: context.actorId,
                    tenantId: context.tenantA,
                    creates: [],
                    updates: [
                        {
                            id: context.mappingA,
                            category: "Travel",
                            accountCode: "6152",
                            description: null,
                        },
                    ],
                    deletes: [],
                },
                secondTestDb,
            ),
        ]);

        const auditRows = await readAuditRows(context.mappingA);
        expect(auditRows).toHaveLength(2);

        const [persisted] = await testDb
            .select({ accountCode: glCode.accountCode })
            .from(glCode)
            .where(eq(glCode.id, context.travelCodeA));
        expect(["6151", "6152"]).toContain(persisted?.accountCode);
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
        mealsCodeAMappingId: randomUUID(),
        suppliesCodeAMappingId: randomUUID(),
        travelCodeA: randomUUID(),
        mealsCodeA: randomUUID(),
        suppliesCodeA: randomUUID(),
        travelCodeB: randomUUID(),
    };
}

async function seedGlReferenceRows(
    transaction: Transaction,
    testContext: ReturnType<typeof createGlMappingTestContext>,
): Promise<void> {
    await transaction.insert(glCode).values([
        {
            id: testContext.travelCodeA,
            tenantId: testContext.tenantA,
            accountCode: "6100",
            accountName: "Travel",
        },
        {
            id: testContext.mealsCodeA,
            tenantId: testContext.tenantA,
            accountCode: "6200",
            accountName: "Meals",
        },
        {
            id: testContext.suppliesCodeA,
            tenantId: testContext.tenantA,
            accountCode: "6300",
            accountName: "Supplies",
        },
        {
            id: testContext.travelCodeB,
            tenantId: testContext.tenantB,
            accountCode: "6100",
            accountName: "Travel",
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
            id: testContext.mealsCodeAMappingId,
            tenantId: testContext.tenantA,
            category: "Meals",
            glCodeId: testContext.mealsCodeA,
        },
        {
            id: testContext.suppliesCodeAMappingId,
            tenantId: testContext.tenantA,
            category: "Supplies",
            glCodeId: testContext.suppliesCodeA,
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
