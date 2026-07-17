import { type Server } from "node:http";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { readCaseQueueStageRollups } from "../../db/queries/caseQueueRollups.js";
import { auditEntry, stageTransition } from "../../db/schema/index.js";
import type { IdempotencyResult } from "../../idempotency/idempotencyStore.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

vi.mock("../../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });

    return {
        db: drizzle(client),
    };
});

const idempotencyRecords = vi.hoisted(
    () => new Map<string, IdempotencyResult>(),
);
const idempotencyStoreMock = vi.hoisted(() => ({
    acquireLock: vi.fn().mockResolvedValue("lock-token"),
    clearReservation: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn((tenantId: string, idempotencyKey: string) =>
        Promise.resolve(
            idempotencyRecords.get(`${tenantId}:${idempotencyKey}`),
        ),
    ),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    reserveSubmission: vi.fn().mockResolvedValue(true),
    saveResult: vi.fn(
        (
            tenantId: string,
            idempotencyKey: string,
            _token: string,
            result: IdempotencyResult,
        ) => {
            idempotencyRecords.set(`${tenantId}:${idempotencyKey}`, result);

            return Promise.resolve();
        },
    ),
}));

vi.mock("../../idempotency/defaultIdempotencyStore.js", () => ({
    getDefaultIdempotencyStore: () => idempotencyStoreMock,
}));

import { db } from "../../db/client.js";
import { app } from "../../app.js";

async function requestApp(path: string, init?: RequestInit): Promise<Response> {
    const server = await listenOnEphemeralPort();
    const address = server.address();

    if (address === null || typeof address === "string") {
        await closeServer(server);
        throw new Error("Expected test server to listen on a TCP port");
    }

    try {
        return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    } finally {
        await closeServer(server);
    }
}

function listenOnEphemeralPort(): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1");
        server.once("listening", () => {
            resolve(server);
        });
        server.once("error", reject);
    });
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolve();
                return;
            }

            reject(error);
        });
    });
}

void describe("Expense Report routes", () => {
    beforeEach(() => {
        idempotencyRecords.clear();
        idempotencyStoreMock.acquireLock.mockClear();
        idempotencyStoreMock.clearReservation.mockClear();
        idempotencyStoreMock.getResult.mockClear();
        idempotencyStoreMock.releaseLock.mockClear();
        idempotencyStoreMock.reserveSubmission.mockClear();
        idempotencyStoreMock.saveResult.mockClear();
    });

    void test("creates then reads an Expense Report end to end", async () => {
        const tenantId = "70000000-0000-4000-8000-000000000100";
        const owner = "71000000-0000-4000-8000-000000000001";
        const dueDate = "2026-09-03";

        const createResponse = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenant_id: tenantId,
                owner,
                dueDate,
                priority: "Normal",
            }),
        });
        const created = (await createResponse.json()) as {
            id?: string;
            tenantId?: string;
            currentStage?: string;
        };

        expect(createResponse.status).toBe(201);
        expect(created.id).toEqual(expect.any(String));
        expect(created).toMatchObject({
            tenantId,
            currentStage: "Drafted",
        });

        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        const readResponse = await requestApp(`/expense-reports/${created.id}`);
        const readBody = (await readResponse.json()) as {
            id?: string;
            tenantId?: string;
            owner?: string;
            dueDate?: string;
            currentStage?: string;
        };

        expect(readResponse.status).toBe(200);
        expect(readBody).toMatchObject({
            id: created.id,
            tenantId,
            owner,
            dueDate,
            currentStage: "Drafted",
        });

        const rollups = await readCaseQueueStageRollups(db, {
            tenantId,
            asOfDate: "2026-09-01",
        });
        const draftedRollup = rollups.find(
            (rollup) => rollup.currentStage === "Drafted",
        );

        expect(draftedRollup).toMatchObject({
            currentStage: "Drafted",
            reportCount: 1,
        });

        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, created.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, created.id));

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            tenantId,
            expenseReportId: created.id,
            actorId: owner,
            action: "report_created",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
            denialReason: null,
        });
        expect(transitionRows).toHaveLength(1);
        expect(transitionRows[0]).toMatchObject({
            tenantId,
            expenseReportId: created.id,
            actor: owner,
            fromStage: "Drafted",
            toStage: "Drafted",
            reason: "report_created",
        });
    });

    void test("creates a Drafted Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000100";
        const owner = "50000000-0000-4000-8000-000000000001";

        const response = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenant_id: tenantId,
                owner,
                dueDate: "2026-07-31",
                priority: "High",
            }),
        });
        const body = (await response.json()) as {
            id?: string;
            tenantId?: string;
            currentStage?: string;
        };

        expect(response.status).toBe(201);
        expect(body.id).toEqual(expect.any(String));
        expect(body.tenantId).toEqual(tenantId);
        expect(body.currentStage).toEqual("Drafted");
    });

    void test("creates one Expense Report when a submission is retried with the same idempotency key", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000110";
        const owner = "50000000-0000-4000-8000-000000000010";
        const requestBody = JSON.stringify({
            tenant_id: tenantId,
            owner,
            dueDate: "2026-08-06",
            priority: "Normal",
        });
        const headers = {
            "content-type": "application/json",
            "idempotency-key": "expense-submit-110",
        };

        const firstResponse = await requestApp("/expense-reports", {
            method: "POST",
            headers,
            body: requestBody,
        });
        const first = (await firstResponse.json()) as { id?: string };
        const retryResponse = await requestApp("/expense-reports", {
            method: "POST",
            headers,
            body: requestBody,
        });
        const retry = (await retryResponse.json()) as { id?: string };

        expect(firstResponse.status).toBe(201);
        expect(retryResponse.status).toBe(201);
        expect(retry.id).toBe(first.id);
        expect(idempotencyStoreMock.saveResult).toHaveBeenCalledTimes(1);

        const rollups = await readCaseQueueStageRollups(db, {
            tenantId,
            asOfDate: "2026-08-01",
        });
        const draftedRollup = rollups.find(
            (rollup) => rollup.currentStage === "Drafted",
        );

        expect(draftedRollup).toMatchObject({ reportCount: 1 });
    });

    void test("scopes the same idempotency key to each tenant", async () => {
        const owner = "50000000-0000-4000-8000-000000000011";
        const createForTenant = async (tenantId: string) => {
            const response = await requestApp("/expense-reports", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "idempotency-key": "shared-submit-key",
                },
                body: JSON.stringify({
                    tenant_id: tenantId,
                    owner,
                    dueDate: "2026-08-07",
                    priority: "Low",
                }),
            });

            return (await response.json()) as {
                id?: string;
                tenantId?: string;
            };
        };

        const firstTenant = await createForTenant(
            "40000000-0000-4000-8000-000000000111",
        );
        const secondTenant = await createForTenant(
            "40000000-0000-4000-8000-000000000112",
        );

        expect(firstTenant.id).toEqual(expect.any(String));
        expect(secondTenant.id).toEqual(expect.any(String));
        expect(firstTenant.id).not.toBe(secondTenant.id);
        expect(firstTenant.tenantId).not.toBe(secondTenant.tenantId);
        expect(idempotencyStoreMock.saveResult).toHaveBeenCalledTimes(2);
    });

    void test("returns Problem+JSON for an invalid create request", async () => {
        const response = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenant_id: "40000000-0000-4000-8000-000000000105",
                dueDate: "2026-07-31",
            }),
        });
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Bad Request",
            status: 400,
        });
    });

    void test("reads an Expense Report by id", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000101";
        const owner = "50000000-0000-4000-8000-000000000002";

        const createResponse = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenant_id: tenantId,
                owner,
                dueDate: "2026-08-01",
            }),
        });
        const created = (await createResponse.json()) as {
            id: string;
        };

        const readResponse = await requestApp(`/expense-reports/${created.id}`);
        const readBody = (await readResponse.json()) as {
            id?: string;
            tenantId?: string;
            currentStage?: string;
        };

        expect(readResponse.status).toBe(200);
        expect(readBody).toMatchObject({
            id: created.id,
            tenantId,
            currentStage: "Drafted",
        });
    });

    void test("reads a recently saved Expense Report by id without tenant context", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000102";
        const owner = "50000000-0000-4000-8000-000000000003";

        const createResponse = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenant_id: tenantId,
                owner,
                dueDate: "2026-08-02",
            }),
        });
        const created = (await createResponse.json()) as {
            id: string;
        };

        const readResponse = await requestApp(`/expense-reports/${created.id}`);
        const body = (await readResponse.json()) as {
            id?: string;
            tenantId?: string;
            currentStage?: string;
        };

        expect(readResponse.status).toBe(200);
        expect(body).toMatchObject({
            id: created.id,
            tenantId,
            currentStage: "Drafted",
        });
    });

    void test("returns Problem+JSON when a report is not found", async () => {
        const response = await requestApp(
            "/expense-reports/60000000-0000-4000-8000-000000000001",
        );
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Not Found",
            status: 404,
        });
    });

    void test("returns Problem+JSON when the route id is invalid", async () => {
        const response = await requestApp("/expense-reports/not-a-report-id");
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Bad Request",
            status: 400,
        });
    });
});
