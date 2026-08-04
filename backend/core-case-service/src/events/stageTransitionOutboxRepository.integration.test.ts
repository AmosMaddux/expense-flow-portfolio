import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, test, vi } from "vitest";

import {
    expenseReport,
    stageTransition,
    stageTransitionOutbox,
} from "../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";

const testDatabase: { client: Pool | undefined } = vi.hoisted(() => ({
    client: undefined,
}));

vi.mock("../db/client.js", () => {
    testDatabase.client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });
    const db = drizzle(testDatabase.client);

    return { db };
});

import {
    claimStageTransitionOutboxEvents,
    markStageTransitionOutboxEventFailed,
    markStageTransitionOutboxEventPublished,
} from "./stageTransitionOutboxRepository.js";

afterAll(async () => {
    await testDatabase.client?.end();
});

void describe("stageTransitionOutboxRepository", () => {
    void test("reports stale completion after an expired lease is reclaimed", async () => {
        const tenantId = randomUUID();
        const reportId = randomUUID();
        const ownerId = randomUUID();
        const transitionId = randomUUID();
        const eventId = randomUUID();
        const claimTime = new Date("2026-07-29T18:00:00.000Z");
        const reclaimTime = new Date("2026-07-29T18:00:31.000Z");

        await seedOutboxRow({
            eventId,
            ownerId,
            reportId,
            tenantId,
            transitionId,
        });

        const [claimedEvent] = await claimStageTransitionOutboxEvents({
            eventId,
            leaseMilliseconds: 30_000,
            limit: 1,
            maxAttempts: 10,
            now: claimTime,
        });

        expect(claimedEvent).toBeDefined();

        if (claimedEvent === undefined) {
            throw new Error("Expected an outbox event to be claimed.");
        }

        const [reclaimedEvent] = await claimStageTransitionOutboxEvents({
            eventId,
            leaseMilliseconds: 30_000,
            limit: 1,
            maxAttempts: 10,
            now: reclaimTime,
        });

        expect(reclaimedEvent).toBeDefined();

        if (reclaimedEvent === undefined) {
            throw new Error(
                "Expected an expired outbox lease to be reclaimed.",
            );
        }

        const staleCompletion = await markStageTransitionOutboxEventPublished(
            claimedEvent,
            new Date("2026-07-29T18:00:32.000Z"),
        );
        const validCompletion = await markStageTransitionOutboxEventPublished(
            reclaimedEvent,
            new Date("2026-07-29T18:00:33.000Z"),
        );

        expect(staleCompletion).toBe(false);
        expect(validCompletion).toBe(true);
    });

    void test("reports stale failure completion after an expired lease is reclaimed", async () => {
        const tenantId = randomUUID();
        const reportId = randomUUID();
        const ownerId = randomUUID();
        const transitionId = randomUUID();
        const eventId = randomUUID();
        const claimTime = new Date("2026-07-29T19:00:00.000Z");
        const reclaimTime = new Date("2026-07-29T19:00:31.000Z");

        await seedOutboxRow({
            eventId,
            ownerId,
            reportId,
            tenantId,
            transitionId,
        });

        const [claimedEvent] = await claimStageTransitionOutboxEvents({
            eventId,
            leaseMilliseconds: 30_000,
            limit: 1,
            maxAttempts: 10,
            now: claimTime,
        });

        expect(claimedEvent).toBeDefined();

        if (claimedEvent === undefined) {
            throw new Error("Expected an outbox event to be claimed.");
        }

        const [reclaimedEvent] = await claimStageTransitionOutboxEvents({
            eventId,
            leaseMilliseconds: 30_000,
            limit: 1,
            maxAttempts: 10,
            now: reclaimTime,
        });

        expect(reclaimedEvent).toBeDefined();

        if (reclaimedEvent === undefined) {
            throw new Error(
                "Expected an expired outbox lease to be reclaimed.",
            );
        }

        const staleCompletion = await markStageTransitionOutboxEventFailed(
            claimedEvent,
            new Date("2026-07-29T19:00:32.000Z"),
        );
        const validCompletion = await markStageTransitionOutboxEventFailed(
            reclaimedEvent,
            new Date("2026-07-29T19:00:33.000Z"),
        );

        expect(staleCompletion).toBe(false);
        expect(validCompletion).toBe(true);
    });
});

async function seedOutboxRow(input: {
    eventId: string;
    ownerId: string;
    reportId: string;
    tenantId: string;
    transitionId: string;
}): Promise<void> {
    const { db } = await import("../db/client.js");

    await db.insert(expenseReport).values({
        id: input.reportId,
        tenantId: input.tenantId,
        owner: input.ownerId,
        dueDate: "2026-07-30",
    });
    await db.insert(stageTransition).values({
        id: input.transitionId,
        expenseReportId: input.reportId,
        tenantId: input.tenantId,
        fromStage: "Drafted",
        toStage: "Submitted",
        actor: input.ownerId,
        reason: "employee submitted report",
        occurredAt: new Date("2026-07-29T17:59:00.000Z"),
    });
    await db.insert(stageTransitionOutbox).values({
        id: input.eventId,
        stageTransitionId: input.transitionId,
        expenseReportId: input.reportId,
        tenantId: input.tenantId,
        correlationId: randomUUID(),
        fromStage: "Drafted",
        toStage: "Submitted",
        occurredAt: new Date("2026-07-29T17:59:00.000Z"),
        nextAttemptAt: new Date("2026-07-29T17:59:00.000Z"),
    });
}
