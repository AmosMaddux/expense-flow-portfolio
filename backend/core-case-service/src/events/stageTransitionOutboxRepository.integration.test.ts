import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import {
    expenseReport,
    stageTransition,
    stageTransitionOutbox,
} from "../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";

vi.mock("../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });
    const db = drizzle(client);

    return { db };
});

import {
    claimStageTransitionOutboxEvents,
    markStageTransitionOutboxEventPublished,
} from "./stageTransitionOutboxRepository.js";

void describe("stageTransitionOutboxRepository", () => {
    void test("reports stale completion when the claimed lock no longer matches", async () => {
        const tenantId = randomUUID();
        const reportId = randomUUID();
        const ownerId = randomUUID();
        const transitionId = randomUUID();
        const eventId = randomUUID();
        const claimTime = new Date("2026-07-29T18:00:00.000Z");

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

        const staleCompletion = await markStageTransitionOutboxEventPublished(
            { ...claimedEvent, lockId: randomUUID() },
            new Date("2026-07-29T18:00:01.000Z"),
        );
        const validCompletion = await markStageTransitionOutboxEventPublished(
            claimedEvent,
            new Date("2026-07-29T18:00:02.000Z"),
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
