import { type Server } from "node:http";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    IdempotencyRequestMismatchError,
    type IdempotencyResult,
} from "../../idempotency/idempotencyStore.js";
import { GlCodingServiceError } from "../../glCoding/glCodingErrors.js";

import { signAccessToken } from "../../auth/shared/accessTokenSigner.js";
import { verifyAccessToken } from "../../auth/shared/accessTokenMiddleware.js";
import { signRefreshToken } from "../../auth/shared/refreshTokenSigner.js";
import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import { readCaseQueueStageRollups } from "../../db/queries/caseQueueRollups.js";
import {
    auditEntry,
    expenseReport,
    glCodingResult,
    lineItem,
    mileageEntry,
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
    () => new Map<string, { requestHash: string; result: IdempotencyResult }>(),
);
const idempotencyStoreMock = vi.hoisted(() => ({
    acquireLock: vi.fn().mockResolvedValue("lock-token"),
    clearReservation: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn(
        (tenantId: string, idempotencyKey: string, requestHash: string) => {
            const record = idempotencyRecords.get(
                `${tenantId}:${idempotencyKey}`,
            );
            if (record === undefined) {
                return Promise.resolve(undefined);
            }

            if (record.requestHash !== requestHash) {
                return Promise.reject(new IdempotencyRequestMismatchError());
            }

            return Promise.resolve(record.result);
        },
    ),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    reserveSubmission: vi.fn().mockResolvedValue(true),
    saveResult: vi.fn(
        (
            tenantId: string,
            idempotencyKey: string,
            _token: string,
            requestHash: string,
            result: IdempotencyResult,
        ) => {
            idempotencyRecords.set(`${tenantId}:${idempotencyKey}`, {
                requestHash,
                result,
            });

            return Promise.resolve();
        },
    ),
}));

vi.mock("../../idempotency/defaultIdempotencyStore.js", () => ({
    getDefaultIdempotencyStore: () => idempotencyStoreMock,
}));

const glCodingClientMock = vi.hoisted(() => vi.fn());

vi.mock("../../glCoding/glCodingClient.js", () => ({
    codeExpenseLineItems: glCodingClientMock,
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
        idempotencyStoreMock.clearReservation.mockClear();
        idempotencyStoreMock.getResult.mockClear();
        idempotencyStoreMock.releaseLock.mockClear();
        idempotencyStoreMock.reserveSubmission.mockClear();
        idempotencyStoreMock.saveResult.mockClear();
        glCodingClientMock.mockReset();
        glCodingClientMock.mockResolvedValue({
            coded_items: [],
            flags: [],
        });
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
                "idempotency-key": "expense-submit-e2e",
            },
            body: JSON.stringify({
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
        expect(createResponse.headers.get("ratelimit-limit")).toBe("2");
        expect(createResponse.headers.get("ratelimit-remaining")).toBe("1");
        expect(createResponse.headers.get("x-ratelimit-cost")).toBe("1");
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
        expect(readResponse.headers.get("ratelimit-limit")).toBe("2");
        expect(readResponse.headers.get("ratelimit-remaining")).toBe("0");
        expect(readResponse.headers.get("x-ratelimit-cost")).toBe("1");
        expect(readBody).toMatchObject({
            id: created.id,
            tenantId,
            owner,
            dueDate,
            currentStage: "Drafted",
        });

        const limitedResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-rate-limit",
            },
            body: "{",
        });
        expect(limitedResponse.status).toBe(429);
        expect(limitedResponse.headers.get("retry-after")).toBeTruthy();
        expect(limitedResponse.headers.get("ratelimit-limit")).toBe("2");
        expect(limitedResponse.headers.get("x-ratelimit-cost")).toBe("1");
        await expect(limitedResponse.json()).resolves.toMatchObject({
            title: "Too Many Requests",
            status: 429,
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
                "idempotency-key": "expense-submit-100",
            },
            body: JSON.stringify({
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

    void test("rejects client-supplied tenant scope in create requests", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000114";
        const owner = "50000000-0000-4000-8000-000000000016";

        const response = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-114",
            },
            body: JSON.stringify({
                tenant_id: "40000000-0000-4000-8000-000000000999",
                owner,
                dueDate: "2026-08-08",
                priority: "High",
            }),
        });
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
            title: "Bad Request",
            status: 400,
        });
    });

    void test("requires an Idempotency-Key header for create requests", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000116";
        const owner = "50000000-0000-4000-8000-000000000018";

        const response = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                owner,
                dueDate: "2026-08-11",
                priority: "Normal",
            }),
        });
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
            title: "Bad Request",
            status: 400,
        });
        expect(idempotencyStoreMock.reserveSubmission).not.toHaveBeenCalled();
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

    void test("rejects an idempotency key reused with a different create body", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000122";
        const owner = "50000000-0000-4000-8000-000000000017";
        const headers = {
            authorization: authorizationHeader(tenantId, owner),
            "content-type": "application/json",
            "idempotency-key": "expense-submit-115",
        };

        const firstResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers,
            body: JSON.stringify({
                owner,
                dueDate: "2026-08-09",
                priority: "Normal",
            }),
        });
        const mismatchResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers,
            body: JSON.stringify({
                owner,
                dueDate: "2026-08-10",
                priority: "Normal",
            }),
        });
        const mismatchBody = (await mismatchResponse.json()) as {
            title?: string;
            status?: number;
        };

        expect(firstResponse.status).toBe(201);
        expect(mismatchResponse.status).toBe(409);
        expect(mismatchBody).toMatchObject({
            title: "Conflict",
            status: 409,
        });
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
                "idempotency-key": "expense-submit-105",
            },
            body: JSON.stringify({
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
                "idempotency-key": "expense-submit-108",
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
                "idempotency-key": "expense-submit-109",
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

    void test("submits a Drafted report as a Department Manager with a tenant JWT", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000130";
        const owner = "50000000-0000-4000-8000-000000000130";
        const managerId = "50000000-0000-4000-8000-000000000131";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-130",
            },
            body: JSON.stringify({
                owner,
                dueDate: "2026-08-12",
            }),
        });
        const created = (await createResponse.json()) as { id?: string };

        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        await db.insert(lineItem).values({
            id: "30000000-0000-4000-8000-000000000130",
            tenantId,
            expenseReportId: created.id,
            merchant: "Synthetic Air",
            amount: "501.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(mileageEntry).values({
            id: "30000000-0000-4000-8000-000000000131",
            tenantId,
            expenseReportId: created.id,
            route: "Synthetic office to airport",
            distance: "42.00",
            mileageDate: "2026-07-18",
        });
        glCodingClientMock.mockResolvedValueOnce({
            coded_items: [
                {
                    source_id: "30000000-0000-4000-8000-000000000130",
                    source_type: "line_item",
                    category: "Travel",
                    mapping_status: "mapped",
                    gl_account: {
                        account_code: "6000",
                        account_name: "Travel Expense",
                    },
                    amount: "501.00",
                    currency: "USD",
                    flagged_line_item: true,
                },
                {
                    source_id: "30000000-0000-4000-8000-000000000131",
                    source_type: "mileage",
                    category: "Mileage",
                    mapping_status: "mapped",
                    gl_account: {
                        account_code: "6300",
                        account_name: "Mileage Expense",
                    },
                    amount: "29.40",
                    currency: "USD",
                    flagged_line_item: false,
                },
            ],
            flags: [],
        });

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-130",
                },
                body: JSON.stringify({}),
            },
        );
        const body = (await response.json()) as { currentStage?: string };

        expect(response.status).toBe(201);
        expect(body.currentStage).toBe("Submitted");
        expect(glCodingClientMock).toHaveBeenCalledOnce();
        const glRequest = glCodingClientMock.mock.calls[0]?.[1] as {
            line_items: unknown[];
            mileage: unknown[];
        };
        const glOptions = glCodingClientMock.mock.calls[0]?.[2] as {
            accessToken?: string;
        };
        expect(glRequest.line_items).toHaveLength(1);
        expect(glRequest.mileage).toHaveLength(1);
        expect(glOptions.accessToken).toBeDefined();

        const outboundAuth = verifyAccessToken(
            glOptions.accessToken ?? "",
            loadAuthJwtConfig(),
        );
        expect(outboundAuth).toEqual({
            tenantId,
            userId: managerId,
            roles: ["Department Manager"],
        });
    });

    void test("rejects Employee submission attempts", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000132";
        const owner = "50000000-0000-4000-8000-000000000132";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-132",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-12" }),
        });
        const created = (await createResponse.json()) as { id?: string };

        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-132",
                },
                body: JSON.stringify({}),
            },
        );

        expect(response.status).toBe(403);
        expect(glCodingClientMock).not.toHaveBeenCalled();
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, created.id),
                ),
            );
        expect(auditRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: "transition_denied",
                    stageBeforeAction: "Drafted",
                    stageAfterProposedAction: "Submitted",
                    denialReason:
                        "Authenticated role is not permitted to submit Expense Reports.",
                }),
            ]),
        );
    });

    void test("requires an Idempotency-Key header for submit requests", async () => {
        const response = await requestApp(
            "/v1/expense-reports/10000000-0000-4000-8000-000000000133/submit",
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000133",
                        "50000000-0000-4000-8000-000000000133",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({}),
            },
        );

        expect(response.status).toBe(400);
        expect(idempotencyStoreMock.reserveSubmission).not.toHaveBeenCalled();
    });

    void test("rejects malformed submit request bodies", async () => {
        const response = await requestApp(
            "/v1/expense-reports/10000000-0000-4000-8000-000000000134/submit",
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000134",
                        "50000000-0000-4000-8000-000000000134",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-134",
                },
                body: JSON.stringify({ unexpected: true }),
            },
        );

        expect(response.status).toBe(400);
        expect(glCodingClientMock).not.toHaveBeenCalled();
    });

    void test("returns not found for missing submit targets", async () => {
        const response = await requestApp(
            "/v1/expense-reports/10000000-0000-4000-8000-000000000135/submit",
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000135",
                        "50000000-0000-4000-8000-000000000135",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-135",
                },
                body: JSON.stringify({}),
            },
        );

        expect(response.status).toBe(404);
        expect(glCodingClientMock).not.toHaveBeenCalled();
    });

    void test("does not submit or audit a report from another tenant", async () => {
        const tenantA = "40000000-0000-4000-8000-000000000140";
        const tenantB = "40000000-0000-4000-8000-000000000141";
        const owner = "50000000-0000-4000-8000-000000000140";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantA, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-140",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-12" }),
        });
        const created = (await createResponse.json()) as { id?: string };

        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantB,
                        "50000000-0000-4000-8000-000000000141",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-140",
                },
                body: JSON.stringify({}),
            },
        );
        const reportRows = await db
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, tenantA),
                    eq(expenseReport.id, created.id),
                ),
            );
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantA),
                    eq(auditEntry.expenseReportId, created.id),
                ),
            );

        expect(response.status).toBe(404);
        expect(glCodingClientMock).not.toHaveBeenCalled();
        expect(reportRows[0]?.currentStage).toBe("Drafted");
        expect(auditRows).toHaveLength(1);
    });

    void test("rejects submit requests for reports that are not Drafted", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000136";
        const owner = "50000000-0000-4000-8000-000000000136";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-136",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-13" }),
        });
        const created = (await createResponse.json()) as { id?: string };

        await db
            .update(expenseReport)
            .set({ currentStage: "Submitted" })
            .where(eq(expenseReport.id, created.id ?? ""));

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        "50000000-0000-4000-8000-000000000137",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-136",
                },
                body: JSON.stringify({}),
            },
        );

        expect(response.status).toBe(409);
        expect(glCodingClientMock).not.toHaveBeenCalled();
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, created.id ?? ""),
                ),
            );
        expect(auditRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: "transition_denied",
                    stageBeforeAction: "Submitted",
                    stageAfterProposedAction: "Submitted",
                    denialReason:
                        "Only Drafted Expense Reports can be submitted.",
                }),
            ]),
        );
    });

    void test("keeps the report Drafted when GL coding fails", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000138";
        const owner = "50000000-0000-4000-8000-000000000138";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-138",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-14" }),
        });
        const created = (await createResponse.json()) as { id?: string };

        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        glCodingClientMock.mockRejectedValueOnce(
            new GlCodingServiceError("Synthetic GL-coding failure"),
        );

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        "50000000-0000-4000-8000-000000000139",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-138",
                },
                body: JSON.stringify({}),
            },
        );
        const reportRows = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, created.id));
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, created.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, created.id));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, created.id));

        expect(response.status).toBe(502);
        expect(reportRows[0]?.currentStage).toBe("Drafted");
        expect(codingRows).toHaveLength(0);
        expect(transitionRows).toHaveLength(1);
        expect(auditRows).toHaveLength(1);
    });

    void test("keeps the report Drafted when submitted sources change during GL coding", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000142";
        const owner = "50000000-0000-4000-8000-000000000142";
        const lineItemId = "30000000-0000-4000-8000-000000000142";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-142",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-14" }),
        });
        const created = (await createResponse.json()) as { id?: string };

        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: created.id,
            merchant: "Synthetic Air",
            amount: "501.00",
            currency: "USD",
            category: "Travel",
        });
        glCodingClientMock.mockImplementationOnce(async () => {
            await db
                .update(lineItem)
                .set({ amount: "601.00" })
                .where(
                    and(
                        eq(lineItem.tenantId, tenantId),
                        eq(lineItem.id, lineItemId),
                    ),
                );

            return {
                coded_items: [
                    {
                        source_id: lineItemId,
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: true,
                    },
                ],
                flags: [],
            };
        });

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        "50000000-0000-4000-8000-000000000143",
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-142",
                },
                body: JSON.stringify({}),
            },
        );
        const reportRows = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, created.id));
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, created.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, created.id));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, created.id));

        expect(response.status).toBe(502);
        expect(reportRows[0]?.currentStage).toBe("Drafted");
        expect(codingRows).toHaveLength(0);
        expect(transitionRows).toHaveLength(1);
        expect(auditRows).toHaveLength(1);
    });

    void test("lets a Finance Admin read audit entries for an Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000121";
        const owner = "50000000-0000-4000-8000-000000000023";
        const financeAdminId = "50000000-0000-4000-8000-000000000024";

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-121",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-06" }),
        });
        const created = (await createResponse.json()) as { id: string };

        const auditResponse = await requestApp(
            `/v1/expense-reports/${created.id}/audit-entries`,
            {
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                },
            },
        );
        const auditBody = (await auditResponse.json()) as Array<{
            tenantId?: string;
            expenseReportId?: string;
            actorId?: string;
            action?: string;
            rawRequestBody?: unknown;
            paymentReference?: string;
        }>;

        expect(auditResponse.status).toBe(200);
        expect(auditBody).toHaveLength(1);
        expect(auditBody[0]).toMatchObject({
            tenantId,
            expenseReportId: created.id,
            actorId: owner,
            action: "report_created",
        });
        expect(auditBody[0]).not.toHaveProperty("rawRequestBody");
        expect(auditBody[0]).not.toHaveProperty("paymentReference");
    });

    void test("lets a Department Manager read audit entries for an Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000123";
        const owner = "50000000-0000-4000-8000-000000000019";
        const departmentManagerId = "50000000-0000-4000-8000-000000000020";

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-123",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-09" }),
        });
        const created = (await createResponse.json()) as { id: string };

        const auditResponse = await requestApp(
            `/v1/expense-reports/${created.id}/audit-entries`,
            {
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        departmentManagerId,
                        ["Department Manager"],
                    ),
                },
            },
        );
        const auditBody = (await auditResponse.json()) as Array<{
            expenseReportId?: string;
            action?: string;
        }>;

        expect(auditResponse.status).toBe(200);
        expect(auditBody).toHaveLength(1);
        expect(auditBody[0]).toMatchObject({
            expenseReportId: created.id,
            action: "report_created",
        });
    });

    void test("does not let an Employee read audit entries for their own Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000118";
        const owner = "50000000-0000-4000-8000-000000000021";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-118",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-10" }),
        });
        const created = (await createResponse.json()) as { id: string };

        const auditResponse = await requestApp(
            `/v1/expense-reports/${created.id}/audit-entries`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
        const body = (await auditResponse.json()) as {
            title?: string;
            status?: number;
        };

        expect(auditResponse.status).toBe(403);
        expect(body).toMatchObject({ title: "Forbidden", status: 403 });
    });

    void test("does not read audit entries for another tenant", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000119";
        const otherTenantId = "40000000-0000-4000-8000-000000000120";
        const owner = "50000000-0000-4000-8000-000000000015";
        const financeAdminId = "50000000-0000-4000-8000-000000000022";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-119",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-07" }),
        });
        const created = (await createResponse.json()) as { id: string };

        const auditResponse = await requestApp(
            `/v1/expense-reports/${created.id}/audit-entries`,
            {
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                },
            },
        );
        const body = (await auditResponse.json()) as {
            title?: string;
            status?: number;
        };

        expect(auditResponse.status).toBe(404);
        expect(body).toMatchObject({ title: "Not Found", status: 404 });
    });
    void test("reads an Expense Report by id", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000101";
        const owner = "50000000-0000-4000-8000-000000000002";

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-101",
            },
            body: JSON.stringify({
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
                "idempotency-key": "expense-submit-102",
            },
            body: JSON.stringify({
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
                "idempotency-key": "expense-submit-110",
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

    void test("returns 401 for Case Queue rollups without a token", async () => {
        const response = await requestApp(
            "/v1/case-queue/rollups?tenantId=40000000-0000-4000-8000-000000000108&asOfDate=2026-07-20",
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
