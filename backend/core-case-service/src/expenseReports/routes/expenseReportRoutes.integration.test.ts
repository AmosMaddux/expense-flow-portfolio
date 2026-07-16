import { type Server } from "node:http";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { IdempotencyResult } from "../../idempotency/idempotencyStore.js";

import { signAccessToken } from "../../auth/shared/accessTokenSigner.js";
import { signRefreshToken } from "../../auth/shared/refreshTokenSigner.js";
import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import { readCaseQueueStageRollups } from "../../db/queries/caseQueueRollups.js";
import {
    auditEntry,
    stageTransition,
    type RoleName,
} from "../../db/schema/index.js";
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

function authorizationHeader(
    tenantId: string,
    userId: string,
    roles: RoleName[] = ["Employee"],
): string {
    const { accessToken } = signAccessToken(
        { tenantId, userId, roles },
        loadAuthJwtConfig(),
        new Date(),
    );

    return `Bearer ${accessToken}`;
}

function refreshAuthorizationHeader(tenantId: string, userId: string): string {
    const issuedAt = new Date();
    const { refreshToken } = signRefreshToken(
        {
            tenantId,
            userId,
            roles: ["Employee"],
            jwtId: "30000000-0000-4000-8000-000000000001",
        },
        loadAuthJwtConfig(),
        issuedAt,
        new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    return `Bearer ${refreshToken}`;
}

void describe("Expense Report routes", () => {
    beforeEach(() => {
        idempotencyRecords.clear();
        idempotencyStoreMock.acquireLock.mockClear();
        idempotencyStoreMock.getResult.mockClear();
        idempotencyStoreMock.releaseLock.mockClear();
        idempotencyStoreMock.reserveSubmission.mockClear();
        idempotencyStoreMock.saveResult.mockClear();
    });

    void test("creates then reads an Expense Report end to end", async () => {
        const tenantId = "70000000-0000-4000-8000-000000000100";
        const owner = "71000000-0000-4000-8000-000000000001";
        const dueDate = "2026-09-03";

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
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

        const readResponse = await requestApp(
            `/v1/expense-reports/${created.id}`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
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

        const response = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenant_id: "40000000-0000-4000-8000-000000000999",
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

    void test("replays the original result for a retried idempotent create", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000111";
        const owner = "50000000-0000-4000-8000-000000000014";
        const body = JSON.stringify({
            owner,
            dueDate: "2026-08-06",
            priority: "Normal",
        });
        const headers = {
            authorization: authorizationHeader(tenantId, owner),
            "content-type": "application/json",
            "idempotency-key": "expense-submit-111",
        };

        const firstResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers,
            body,
        });
        const first = (await firstResponse.json()) as { id?: string };
        const retryResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers,
            body,
        });
        const retry = (await retryResponse.json()) as { id?: string };

        expect(firstResponse.status).toBe(201);
        expect(retryResponse.status).toBe(201);
        expect(retry.id).toBe(first.id);
        expect(idempotencyStoreMock.saveResult).toHaveBeenCalledTimes(1);
        expect(idempotencyStoreMock.acquireLock).toHaveBeenCalledTimes(1);
    });

    void test("scopes the same idempotency key to each authenticated tenant", async () => {
        const owner = "50000000-0000-4000-8000-000000000015";
        const createForTenant = async (tenantId: string) => {
            const response = await requestApp("/v1/expense-reports", {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "shared-submit-key",
                },
                body: JSON.stringify({
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
            "40000000-0000-4000-8000-000000000112",
        );
        const secondTenant = await createForTenant(
            "40000000-0000-4000-8000-000000000113",
        );

        expect(firstTenant.id).toEqual(expect.any(String));
        expect(secondTenant.id).toEqual(expect.any(String));
        expect(firstTenant.id).not.toBe(secondTenant.id);
        expect(firstTenant.tenantId).not.toBe(secondTenant.tenantId);
        expect(idempotencyStoreMock.saveResult).toHaveBeenCalledTimes(2);
    });

    void test("returns Problem+JSON for an invalid create request", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000105";
        const userId = "50000000-0000-4000-8000-000000000005";
        const response = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, userId),
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

    void test("returns 403 when an Employee creates for another owner", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000108";
        const employeeId = "50000000-0000-4000-8000-000000000008";
        const response = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, employeeId),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                owner: "50000000-0000-4000-8000-000000000009",
                dueDate: "2026-08-03",
            }),
        });
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(403);
        expect(body).toMatchObject({ title: "Forbidden", status: 403 });
    });

    void test("uses the authenticated internal user as the creation audit actor", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000109";
        const financeAdminId = "50000000-0000-4000-8000-000000000010";
        const ownerId = "50000000-0000-4000-8000-000000000011";
        const response = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, financeAdminId, [
                    "Finance Admin",
                ]),
                "content-type": "application/json",
            },
            body: JSON.stringify({ owner: ownerId, dueDate: "2026-08-04" }),
        });
        const created = (await response.json()) as { id?: string };

        expect(response.status).toBe(201);
        expect(created.id).toBeDefined();

        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, created.id ?? ""));
        expect(auditRows[0]?.actorId).toBe(financeAdminId);
    });

    void test("reads an Expense Report by id", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000101";
        const owner = "50000000-0000-4000-8000-000000000002";

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
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

        const readResponse = await requestApp(
            `/v1/expense-reports/${created.id}`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
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

    void test("does not read an Expense Report from another tenant", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000102";
        const owner = "50000000-0000-4000-8000-000000000003";

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
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

        const readResponse = await requestApp(
            `/v1/expense-reports/${created.id}`,
            {
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000103",
                        owner,
                    ),
                },
            },
        );
        const body = (await readResponse.json()) as {
            title?: string;
            status?: number;
        };

        expect(readResponse.status).toBe(404);
        expect(body).toMatchObject({
            title: "Not Found",
            status: 404,
        });
    });

    void test("does not let an Employee read another owner's report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000110";
        const ownerId = "50000000-0000-4000-8000-000000000012";
        const otherEmployeeId = "50000000-0000-4000-8000-000000000013";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, ownerId),
                "content-type": "application/json",
            },
            body: JSON.stringify({ owner: ownerId, dueDate: "2026-08-05" }),
        });
        const created = (await createResponse.json()) as { id: string };

        const readResponse = await requestApp(
            `/v1/expense-reports/${created.id}`,
            {
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        otherEmployeeId,
                    ),
                },
            },
        );
        const body = (await readResponse.json()) as {
            title?: string;
            status?: number;
        };

        expect(readResponse.status).toBe(404);
        expect(body).toMatchObject({ title: "Not Found", status: 404 });
    });

    void test("returns Problem+JSON when a report is not found", async () => {
        const response = await requestApp(
            "/v1/expense-reports/60000000-0000-4000-8000-000000000001",
            {
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000104",
                        "50000000-0000-4000-8000-000000000004",
                    ),
                },
            },
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
        const response = await requestApp(
            "/v1/expense-reports/not-a-report-id",
            {
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000106",
                        "50000000-0000-4000-8000-000000000006",
                    ),
                },
            },
        );
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

    void test("returns 401 before handling a request without a token", async () => {
        const response = await requestApp(
            "/v1/expense-reports/not-a-report-id",
        );
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(401);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Unauthorized",
            status: 401,
        });
    });

    void test("returns 401 when a refresh token is used as a bearer token", async () => {
        const response = await requestApp(
            "/v1/expense-reports/not-a-report-id",
            {
                headers: {
                    authorization: refreshAuthorizationHeader(
                        "40000000-0000-4000-8000-000000000107",
                        "50000000-0000-4000-8000-000000000007",
                    ),
                },
            },
        );
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(401);
        expect(body).toMatchObject({
            title: "Unauthorized",
            status: 401,
        });
    });
});
