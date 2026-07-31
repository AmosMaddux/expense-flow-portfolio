import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { type Server } from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";

import { signAccessToken } from "../../auth/shared/accessTokenSigner.js";
import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import {
    auditEntry,
    expenseReport,
    glCode,
    glCodingResult,
    glMapping,
    lineItem,
    type RoleName,
} from "../../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import {
    syntheticRsaPrivateKeyBase64,
    syntheticRsaPublicKeyBase64,
} from "../../testSupport/jwtTestKeys.js";

vi.mock("../../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });

    return {
        db: drizzle(client),
    };
});

const stageTransitionPublishMock = vi.hoisted(() =>
    vi.fn().mockResolvedValue(undefined),
);

vi.mock("../../events/stageTransitionEventPublisher.js", () => ({
    getDefaultStageTransitionEventPublisher: () => ({
        publish: stageTransitionPublishMock,
    }),
}));

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
                return Promise.reject(new Error("idempotency mismatch"));
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

import { db } from "../../db/client.js";

type IdempotencyResult = {
    body: unknown;
    statusCode: number;
};

type GlCodingServiceResponse = {
    coded_items: Array<{
        source_id?: string;
        mapping_status?: string;
        gl_account?: {
            account_code?: string;
            account_name?: string;
        } | null;
    }>;
};

const repositoryRoot = fileURLToPath(
    new URL("../../../../../", import.meta.url),
);

const tenantId = "40000000-0000-4000-8000-000000000300";
const otherTenantId = "40000000-0000-4000-8000-000000000399";
const reportId = "60000000-0000-4000-8000-000000000300";
const otherTenantReportId = "60000000-0000-4000-8000-000000000399";
const lineItemId = "30000000-0000-4000-8000-000000000300";
const secondFlaggedLineItemId = "30000000-0000-4000-8000-000000000301";
const unflaggedLineItemId = "30000000-0000-4000-8000-000000000302";
const ownerId = "50000000-0000-4000-8000-000000000300";
const financeAdminId = "51000000-0000-4000-8000-000000000300";

let app: Awaited<typeof import("../../app.js")>["app"];
let fastApiProcess: ChildProcessWithoutNullStreams | undefined;
let fastApiOutput = "";
let glCodingBaseUrl = "";

void describe("Expense Report submission across Core Case and GL-coding services", () => {
    beforeAll(async () => {
        const glCodingPort = await reserveEphemeralPort();
        glCodingBaseUrl = `http://127.0.0.1:${glCodingPort}`;
        process.env.DATABASE_URL = getCoreCaseTestDatabaseUrl();
        process.env.GL_CODING_SERVICE_BASE_URL = glCodingBaseUrl;
        process.env.CORE_CASE_RATE_LIMIT_REQUESTS = "20";
        process.env.AUTH_JWT_PRIVATE_KEY_BASE64 = syntheticRsaPrivateKeyBase64;
        process.env.AUTH_JWT_PUBLIC_KEY_BASE64 = syntheticRsaPublicKeyBase64;

        fastApiProcess = spawn(
            "uv",
            [
                "run",
                "uvicorn",
                "backend.python.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                String(glCodingPort),
            ],
            {
                cwd: repositoryRoot,
                env: {
                    ...process.env,
                    AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
                    AUTH_JWT_PUBLIC_KEY_BASE64: syntheticRsaPublicKeyBase64,
                    AUTH_JWT_KEY_ID: "synthetic-vitest-key",
                    DATABASE_URL: getCoreCaseTestDatabaseUrl(),
                    MILEAGE_REIMBURSEMENT_RATE: "0.70",
                },
            },
        );

        fastApiProcess.stdout.on("data", (chunk: Buffer) => {
            fastApiOutput += chunk.toString("utf8");
        });
        fastApiProcess.stderr.on("data", (chunk: Buffer) => {
            fastApiOutput += chunk.toString("utf8");
        });
        fastApiProcess.on("error", (error) => {
            fastApiOutput += error.message;
        });
        fastApiProcess.on("exit", (code, signal) => {
            fastApiOutput += `FastAPI exited with code ${code ?? "none"} and signal ${signal ?? "none"}.`;
        });

        await waitForHttpOk(glCodingBaseUrl + "/health", () => fastApiOutput);

        app = (await import("../../app.js")).app;
    }, 90_000);

    afterAll(async () => {
        await stopProcess(fastApiProcess);
        fastApiProcess = undefined;
    });

    beforeEach(() => {
        idempotencyRecords.clear();
        Object.values(idempotencyStoreMock).forEach((mock) => mock.mockClear());
        stageTransitionPublishMock.mockClear();
    });

    void test("submits through FastAPI coding, rejects cross-tenant access, and blocks flagged advancement until review", async () => {
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-09-01",
            currentStage: "Drafted",
        });
        await db.insert(lineItem).values([
            {
                id: lineItemId,
                tenantId,
                expenseReportId: reportId,
                merchant: "Synthetic Travel Vendor",
                expenseDate: "2026-07-20",
                amount: "501.00",
                currency: "USD",
                category: "Travel",
            },
            {
                id: secondFlaggedLineItemId,
                tenantId,
                expenseReportId: reportId,
                merchant: "Synthetic Meals Vendor",
                expenseDate: "2026-07-20",
                amount: "750.00",
                currency: "USD",
                category: "Meals",
            },
            {
                id: unflaggedLineItemId,
                tenantId,
                expenseReportId: reportId,
                merchant: "Synthetic Supply Vendor",
                expenseDate: "2026-07-20",
                amount: "42.00",
                currency: "USD",
                category: "Office Supplies",
            },
        ]);

        const crossTenantSubmitResponse = await requestApp(
            `/v1/expense-reports/${reportId}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "cross-tenant-submit",
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );

        expect(crossTenantSubmitResponse.status).toBe(404);

        const tenantScopedGlCodingResponse = await requestGlCodingService(
            tenantId,
            lineItemId,
        );
        const tenantScopedGlCodingBody =
            (await tenantScopedGlCodingResponse.json()) as GlCodingServiceResponse;
        const otherTenantGlCodingResponse = await requestGlCodingService(
            otherTenantId,
            lineItemId,
        );
        const otherTenantGlCodingBody =
            (await otherTenantGlCodingResponse.json()) as GlCodingServiceResponse;

        expect(tenantScopedGlCodingResponse.status).toBe(200);
        expect(tenantScopedGlCodingBody.coded_items[0]).toMatchObject({
            source_id: lineItemId,
            mapping_status: "mapped",
            gl_account: {
                account_code: "6000",
                account_name: "Travel Expense",
            },
        });
        expect(otherTenantGlCodingResponse.status).toBe(200);
        expect(otherTenantGlCodingBody.coded_items[0]).toMatchObject({
            source_id: lineItemId,
            mapping_status: "unmapped",
            gl_account: null,
        });

        const submitResponse = await requestApp(
            `/v1/expense-reports/${reportId}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "cross-service-submit",
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );
        const submitted = (await submitResponse.json()) as {
            currentStage?: string;
        };

        expect(submitResponse.status).toBe(201);
        expect(submitted.currentStage).toBe("Submitted");

        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, tenantId),
                    eq(glCodingResult.expenseReportId, reportId),
                ),
            );
        const submissionId = codingRows[0]?.submissionId;

        expect(codingRows).toHaveLength(3);
        expect(submissionId).toEqual(expect.any(String));
        expect(
            codingRows.find((row) => row.sourceId === lineItemId),
        ).toMatchObject({
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            amount: "501.00",
            currency: "USD",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });
        expect(
            codingRows.find((row) => row.sourceId === secondFlaggedLineItemId),
        ).toMatchObject({
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: secondFlaggedLineItemId,
            category: "Meals",
            mappingStatus: "mapped",
            glAccountCode: "6100",
            glAccountName: "Meals Expense",
            amount: "750.00",
            currency: "USD",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
        });
        expect(
            codingRows.find((row) => row.sourceId === unflaggedLineItemId),
        ).toMatchObject({
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: unflaggedLineItemId,
            category: "Office Supplies",
            mappingStatus: "mapped",
            glAccountCode: "6400",
            glAccountName: "Office Supplies Expense",
            amount: "42.00",
            currency: "USD",
            flaggedLineItem: false,
            flagCode: null,
        });

        await seedOtherTenantCodingRowWithSharedSourceId(lineItemId);

        const crossTenantReadResponse = await requestApp(
            `/v1/expense-reports/${reportId}`,
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

        expect(crossTenantReadResponse.status).toBe(404);

        const managerApprovalResponse = await transitionReport(
            "Manager Approval",
            "ready for manager review",
        );
        expect(managerApprovalResponse.status).toBe(200);

        const blockedApReviewResponse = await transitionReport(
            "AP Review",
            "attempt before flag review",
        );
        const reportAfterBlockedTransition = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, reportId));
        const deniedAuditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.expenseReportId, reportId),
                    eq(auditEntry.action, "transition_denied"),
                ),
            );

        expect(blockedApReviewResponse.status).toBe(409);
        expect(reportAfterBlockedTransition[0]).toMatchObject({
            currentStage: "Manager Approval",
        });
        expect(deniedAuditRows[0]).toMatchObject({
            tenantId,
            expenseReportId: reportId,
            actorId: financeAdminId,
            stageBeforeAction: "Manager Approval",
            stageAfterProposedAction: "AP Review",
            denialReason:
                "Expense Report has uncleared over-threshold line-item flags.",
        });

        const crossTenantClearResponse = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [lineItemId],
                    reason: "cross-tenant synthetic clear attempt",
                }),
            },
        );

        expect(crossTenantClearResponse.status).toBe(404);

        const clearResponse = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [lineItemId],
                    reason: "reviewed over-threshold synthetic line item",
                }),
            },
        );
        const clearBody = (await clearResponse.json()) as {
            clearedFlagCount?: number;
        };
        const codingRowsAfterFirstClear = await db
            .select()
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, tenantId),
                    eq(glCodingResult.expenseReportId, reportId),
                    eq(glCodingResult.submissionId, submissionId as string),
                    eq(glCodingResult.sourceId, lineItemId),
                ),
            );
        const otherTenantCodingRowsAfterFirstClear = await db
            .select()
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, otherTenantId),
                    eq(glCodingResult.expenseReportId, otherTenantReportId),
                    eq(glCodingResult.sourceId, lineItemId),
                ),
            );

        expect(clearResponse.status).toBe(200);
        expect(clearBody.clearedFlagCount).toBe(1);
        expect(codingRowsAfterFirstClear[0]).toMatchObject({
            flaggedLineItem: false,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });
        expect(otherTenantCodingRowsAfterFirstClear[0]).toMatchObject({
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
        });

        const stillBlockedApReviewResponse = await transitionReport(
            "AP Review",
            "attempt while second flag remains",
        );
        expect(stillBlockedApReviewResponse.status).toBe(409);

        const secondClearResponse = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [secondFlaggedLineItemId],
                    reason: "reviewed remaining synthetic line-item flag",
                }),
            },
        );
        const secondClearBody = (await secondClearResponse.json()) as {
            clearedFlagCount?: number;
        };

        expect(secondClearResponse.status).toBe(200);
        expect(secondClearBody.clearedFlagCount).toBe(1);

        const reviewResponses = await Promise.all(
            [lineItemId, secondFlaggedLineItemId, unflaggedLineItemId].map(
                (sourceId) =>
                    requestApp(
                        `/v1/expense-reports/${reportId}/sources/line_item/${sourceId}/review`,
                        {
                            method: "POST",
                            headers: {
                                authorization: authorizationHeader(
                                    tenantId,
                                    financeAdminId,
                                    ["Finance Admin"],
                                ),
                                "content-type": "application/json",
                            },
                            body: JSON.stringify({ action: "approve" }),
                        },
                    ),
            ),
        );
        expect(reviewResponses.map((response) => response.status)).toEqual([
            200, 200, 200,
        ]);

        const apReviewResponse = await transitionReport(
            "AP Review",
            "flags and line items reviewed",
        );
        const apReviewBody = (await apReviewResponse.json()) as {
            currentStage?: string;
        };

        expect(apReviewResponse.status).toBe(200);
        expect(apReviewBody.currentStage).toBe("AP Review");
    });
});

function authorizationHeader(
    authenticatedTenantId: string,
    userId: string,
    roles: RoleName[],
): string {
    const { accessToken } = signAccessToken(
        { tenantId: authenticatedTenantId, userId, roles },
        loadAuthJwtConfig(),
        new Date(),
    );

    return `Bearer ${accessToken}`;
}

async function requestGlCodingService(
    authenticatedTenantId: string,
    sourceId: string,
): Promise<Response> {
    return fetch(`${glCodingBaseUrl}/gl-coding/line-items`, {
        method: "POST",
        headers: {
            authorization: authorizationHeader(
                authenticatedTenantId,
                financeAdminId,
                ["Finance Admin"],
            ),
            "content-type": "application/json",
        },
        body: JSON.stringify({
            line_items: [
                {
                    line_item_id: sourceId,
                    merchant: "Synthetic Travel Vendor",
                    amount: "501.00",
                    currency: "USD",
                    category: "Travel",
                },
            ],
            mileage: [],
        }),
    });
}

async function seedOtherTenantCodingRowWithSharedSourceId(
    sourceId: string,
): Promise<void> {
    await db.insert(glCode).values({
        id: "10000000-0000-4000-8000-000000000399",
        tenantId: otherTenantId,
        accountCode: "9600",
        accountName: "Other Tenant Travel Expense",
        description: "Synthetic tenant-isolation guard account",
    });
    await db.insert(glMapping).values({
        id: "20000000-0000-4000-8000-000000000399",
        tenantId: otherTenantId,
        category: "Travel",
        glCodeId: "10000000-0000-4000-8000-000000000399",
    });
    await db.insert(expenseReport).values({
        id: otherTenantReportId,
        tenantId: otherTenantId,
        owner: ownerId,
        dueDate: "2026-09-02",
        currentStage: "Manager Approval",
    });
    await db.insert(glCodingResult).values({
        id: "91000000-0000-4000-8000-000000000399",
        submissionId: "90000000-0000-4000-8000-000000000399",
        tenantId: otherTenantId,
        expenseReportId: otherTenantReportId,
        sourceType: "line_item",
        sourceId,
        category: "Travel",
        mappingStatus: "mapped",
        glAccountCode: "9600",
        glAccountName: "Other Tenant Travel Expense",
        amount: "501.00",
        currency: "USD",
        flaggedLineItem: true,
        flagCode: "line_item_over_threshold",
        flagMessage: "Synthetic other-tenant flag must remain isolated.",
    });
}

async function transitionReport(
    toStage: string,
    reason: string,
): Promise<Response> {
    return requestApp(`/v1/expense-reports/${reportId}/transitions`, {
        method: "POST",
        headers: {
            authorization: authorizationHeader(tenantId, financeAdminId, [
                "Finance Admin",
            ]),
            "content-type": "application/json",
        },
        body: JSON.stringify({ toStage, reason }),
    });
}

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

async function closeTcpServer(server: net.Server): Promise<void> {
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

async function reserveEphemeralPort(): Promise<number> {
    const server = net.createServer();

    await new Promise<void>((resolve, reject) => {
        server.listen(0, "127.0.0.1", resolve);
        server.once("error", reject);
    });

    const address = server.address();
    await closeTcpServer(server);

    if (address === null || typeof address === "string") {
        throw new Error("Expected an ephemeral TCP port.");
    }

    return address.port;
}

async function waitForHttpOk(
    url: string,
    readDiagnostics: () => string,
): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;

    while (Date.now() - startedAt < 60_000) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
        } catch (error: unknown) {
            lastError = error;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("Timed out waiting for " + url + ": " + readDiagnostics(), {
        cause: lastError,
    });
}

async function stopProcess(
    childProcess: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
    if (childProcess === undefined || childProcess.killed) {
        return;
    }

    await new Promise<void>((resolve) => {
        childProcess.once("exit", () => resolve());
        childProcess.kill();
        setTimeout(resolve, 5_000).unref();
    });
}
