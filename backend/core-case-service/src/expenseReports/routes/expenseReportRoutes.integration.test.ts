import { randomUUID } from "node:crypto";
import { type Server } from "node:http";

import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Express } from "express";
import { beforeEach, beforeAll, describe, expect, test, vi } from "vitest";

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
    attachmentMetadata,
    auditEntry,
    caseComment,
    expenseReport,
    expenseReportSettlement,
    glCodingResult,
    lineItem,
    mileageEntry,
    receiptMetadata,
    stageTransition,
    stageTransitionOutbox,
    tenantExpensePolicy,
    tenantRateLimitWindow,
    type RoleName,
} from "../../db/schema/index.js";
import { PolicyReferenceOutboundResponseSchema } from "../dto/expenseReportDto.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";

const einValidationAclValidateMock = vi.hoisted(() => vi.fn());

vi.mock("../../tinEin/tinEinValidationAcl.js", () => ({
    createEinValidationAcl: () => ({
        validateEin: einValidationAclValidateMock,
    }),
}));
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
    saveResult: vi.fn(
        (
            tenantId: string,
            idempotencyKey: string,
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
const redisCacheEntries = vi.hoisted(() => new Map<string, string>());
const redisClientMock = vi.hoisted(() => ({
    get: vi.fn((key: string) =>
        Promise.resolve(redisCacheEntries.get(key) ?? null),
    ),
    set: vi.fn((key: string, value: string) => {
        redisCacheEntries.set(key, value);
        return Promise.resolve("OK");
    }),
    incr: vi.fn((key: string) => {
        const nextValue = String(Number(redisCacheEntries.get(key) ?? "0") + 1);
        redisCacheEntries.set(key, nextValue);
        return Promise.resolve(Number(nextValue));
    }),
}));
const receiptStorageMock = vi.hoisted(() => ({
    put: vi.fn().mockResolvedValue({
        objectKey: "synthetic/receipt-object",
    }),
    verify: vi.fn().mockResolvedValue({
        objectKey: "synthetic/receipt-object",
    }),
}));
const stageTransitionPublishMock = vi.hoisted(() =>
    vi.fn().mockResolvedValue(undefined),
);

vi.mock("../../cache/redisClient.js", () => ({
    getRedisClient: () => Promise.resolve(redisClientMock),
}));

vi.mock("../../glCoding/glCodingClient.js", () => ({
    codeExpenseLineItems: glCodingClientMock,
}));
vi.mock("../../receipts/receiptStorage.js", () => ({
    getDefaultReceiptStorage: () => receiptStorageMock,
}));
vi.mock("../../events/stageTransitionEventPublisher.js", () => ({
    getDefaultStageTransitionEventPublisher: () => ({
        publish: stageTransitionPublishMock,
    }),
}));

import { db } from "../../db/client.js";

let app: Express;

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

function buildDashboardTrendReport(
    id: string,
    tenantId: string,
    owner: string,
    createdAt: string,
) {
    return {
        id,
        createdAt: new Date(createdAt),
        currentStage: "Submitted",
        dueDate: "2026-08-01",
        owner,
        tenantId,
    };
}

function buildDashboardTrendLineItem(
    id: string,
    tenantId: string,
    expenseReportId: string,
    amount: string,
    currency: string,
) {
    return {
        id,
        amount,
        category: "Travel",
        currency,
        expenseDate: "2026-07-01",
        expenseReportId,
        merchant: "Synthetic Merchant",
        tenantId,
    };
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
        einValidationAclValidateMock.mockReset();
        einValidationAclValidateMock.mockResolvedValue({
            status: "valid",
            isValid: true,
            normalizedLegalName: "Synthetic Employer LLC",
            serviceReferenceId: "synthetic-ein-reference",
        });
        idempotencyRecords.clear();
        idempotencyStoreMock.acquireLock.mockClear();
        idempotencyStoreMock.getResult.mockClear();
        idempotencyStoreMock.releaseLock.mockClear();
        idempotencyStoreMock.saveResult.mockClear();
        glCodingClientMock.mockReset();
        redisCacheEntries.clear();
        redisClientMock.get.mockClear();
        redisClientMock.set.mockClear();
        redisClientMock.incr.mockClear();
        receiptStorageMock.put.mockClear();
        receiptStorageMock.verify.mockClear();
        stageTransitionPublishMock.mockClear();
        glCodingClientMock.mockResolvedValue({
            coded_items: [],
            flags: [],
        });
    });

    beforeAll(async () => {
        process.env.AUTH_JWT_PRIVATE_KEY_BASE64 = syntheticRsaPrivateKeyBase64;
        process.env.AUTH_JWT_KEY_ID = "synthetic-key-v1";
        process.env.MFA_TOTP_SECRET_ENCRYPTION_KEY = Buffer.alloc(
            32,
            1,
        ).toString("base64");
        process.env.MFA_TOTP_SECRET_KEY_VERSION = "synthetic-v1";
        process.env.MILEAGE_REIMBURSEMENT_RATE = "0.70";
        app = (await import("../../app.js")).app;
    });

    void test("returns the authenticated tenant's Policy Reference text to Department Managers", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000931";
        const otherTenantId = "40000000-0000-4000-8000-000000000932";
        const managerId = "50000000-0000-4000-8000-000000000931";
        const policyText =
            "  Synthetic tenant policy: receipts are required for reimbursable lodging.\n\n    Preserve approved indentation.\n";
        await db.insert(tenantExpensePolicy).values([
            {
                tenantId,
                policyText,
                updatedAt: new Date("2026-07-24T12:00:00.000Z"),
            },
            {
                tenantId: otherTenantId,
                policyText:
                    "Synthetic other tenant policy that must not be returned.",
                updatedAt: new Date("2026-07-25T12:00:00.000Z"),
            },
        ]);

        const response = await requestApp("/v1/policy-reference", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const body = PolicyReferenceOutboundResponseSchema.parse(
            await response.json(),
        );

        expect(response.status).toBe(200);
        expect(body).toEqual({
            policyText,
            updatedAt: "2026-07-24T12:00:00.000Z",
        });
        expect(body.policyText).not.toContain("other tenant");
    });

    void test("returns Policy Reference text to Finance Admins", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000933";
        const financeAdminId = "50000000-0000-4000-8000-000000000933";
        await db.insert(tenantExpensePolicy).values({
            tenantId,
            policyText:
                "Synthetic finance policy: business meals require a business purpose.",
            updatedAt: new Date("2026-07-24T13:00:00.000Z"),
        });

        const response = await requestApp("/v1/policy-reference", {
            headers: {
                authorization: authorizationHeader(tenantId, financeAdminId, [
                    "Finance Admin",
                ]),
            },
        });
        const body = PolicyReferenceOutboundResponseSchema.parse(
            await response.json(),
        );

        expect(response.status).toBe(200);
        expect(body.policyText).toContain("business meals");
    });

    void test("rejects Policy Reference reads for Employee and Admin roles", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000934";
        const userId = "50000000-0000-4000-8000-000000000934";

        for (const roleName of ["Employee", "Admin"] satisfies RoleName[]) {
            const response = await requestApp("/v1/policy-reference", {
                headers: {
                    authorization: authorizationHeader(tenantId, userId, [
                        roleName,
                    ]),
                },
            });
            const body = (await response.json()) as {
                title?: string;
                status?: number;
            };

            expect(response.status).toBe(403);
            expect(body).toMatchObject({
                title: "Forbidden",
                status: 403,
            });
        }
    });

    void test("returns not found when the authenticated tenant has no Policy Reference text", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000935";
        const managerId = "50000000-0000-4000-8000-000000000935";
        await db.insert(tenantExpensePolicy).values({
            tenantId: "40000000-0000-4000-8000-000000000936",
            policyText:
                "Synthetic policy for a different tenant that must stay isolated.",
            updatedAt: new Date("2026-07-24T14:00:00.000Z"),
        });

        const response = await requestApp("/v1/policy-reference", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
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

    void test("lists only the employee's reports with stable bounded pages", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000810";
        const ownerId = "50000000-0000-4000-8000-000000000810";
        const otherOwnerId = "50000000-0000-4000-8000-000000000811";
        const reports = [
            {
                id: "60000000-0000-4000-8000-000000000810",
                updatedAt: new Date("2026-07-23T12:00:00.000Z"),
                createdAt: new Date("2026-07-20T12:00:00.000Z"),
            },
            {
                id: "60000000-0000-4000-8000-000000000811",
                updatedAt: new Date("2026-07-22T12:00:00.000Z"),
                createdAt: new Date("2026-07-19T12:00:00.000Z"),
            },
            {
                id: "60000000-0000-4000-8000-000000000812",
                updatedAt: new Date("2026-07-21T12:00:00.000Z"),
                createdAt: new Date("2026-07-18T12:00:00.000Z"),
            },
        ];
        await db.insert(expenseReport).values([
            ...reports.map((report) => ({
                ...report,
                tenantId,
                owner: ownerId,
                dueDate: "2026-08-01",
                currentStage: "Submitted",
            })),
            {
                id: "60000000-0000-4000-8000-000000000813",
                tenantId,
                owner: otherOwnerId,
                dueDate: "2026-08-01",
                currentStage: "Submitted",
            },
        ]);

        const firstResponse = await requestApp(
            "/v1/expense-reports/my-submissions?pageSize=2",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );
        const firstPage = (await firstResponse.json()) as {
            items?: Array<{ id?: string; tenantId?: string; owner?: string }>;
            nextCursor?: string | null;
        };

        expect(firstResponse.status).toBe(200);
        expect(firstPage.items?.map((report) => report.id)).toEqual([
            reports[0]?.id,
            reports[1]?.id,
        ]);
        expect(firstPage.items?.[0]).not.toHaveProperty("tenantId");
        expect(firstPage.items?.[0]).not.toHaveProperty("owner");
        expect(firstPage.nextCursor).toEqual(expect.any(String));

        const secondResponse = await requestApp(
            `/v1/expense-reports/my-submissions?pageSize=2&cursor=${firstPage.nextCursor}`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );
        const secondPage = (await secondResponse.json()) as {
            items?: Array<{ id?: string }>;
            nextCursor?: string | null;
        };

        expect(secondResponse.status).toBe(200);
        expect(secondPage.items?.map((report) => report.id)).toEqual([
            reports[2]?.id,
        ]);
        expect(secondPage.nextCursor).toBeNull();
    });

    void test("serializes line items from an employee-owned submission detail", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000820";
        const ownerId = "50000000-0000-4000-8000-000000000820";
        const reportId = "60000000-0000-4000-8000-000000000820";
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-08-01",
            currentStage: "Submitted",
        });
        await db.insert(lineItem).values({
            id: "70000000-0000-4000-8000-000000000820",
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Rail",
            expenseDate: "2026-07-18",
            category: "Travel",
            amount: "84.25",
            currency: "USD",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/submission-detail`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );
        const body = (await response.json()) as {
            id?: string;
            lineItems?: Array<{
                merchant?: string;
                amount?: number;
                currency?: string;
            }>;
        };

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            id: reportId,
            lineItems: [
                {
                    merchant: "Synthetic Rail",
                    amount: 84.25,
                    currency: "USD",
                },
            ],
        });
    });

    void test("returns the latest send-back reason to the report owner", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000821";
        const ownerId = "50000000-0000-4000-8000-000000000821";
        const managerId = "51000000-0000-4000-8000-000000000821";
        const reportId = "60000000-0000-4000-8000-000000000821";
        const lineItemId = "70000000-0000-4000-8000-000000000821";
        const mileageEntryId = "71000000-0000-4000-8000-000000000821";
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-08-01",
            currentStage: "Drafted",
        });
        await db.insert(auditEntry).values({
            tenantId,
            expenseReportId: reportId,
            actorId: managerId,
            action: "transition_sent_back",
            stageBeforeAction: "Manager Approval",
            stageAfterProposedAction: "Drafted",
            outcomeReason: "Receipt does not match the submitted amount.",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Cafe",
            expenseDate: "2026-07-18",
            category: "Meals",
            amount: "24.50",
            currency: "USD",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Synthetic Office to Client Site",
            distance: "12.00",
            mileageDate: "2026-07-19",
        });
        await db.insert(glCodingResult).values([
            {
                submissionId: "90000000-0000-4000-8000-000000000821",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Meals",
                mappingStatus: "mapped",
                lineItemReviewAction: "reject",
                lineItemReviewReason: "Receipt amount does not match.",
                lineItemReviewedBy: managerId,
                lineItemReviewedAt: new Date("2026-07-27T12:00:00.000Z"),
            },
            {
                submissionId: "90000000-0000-4000-8000-000000000821",
                tenantId,
                expenseReportId: reportId,
                sourceType: "mileage",
                sourceId: mileageEntryId,
                category: "Mileage",
                mappingStatus: "mapped",
                lineItemReviewAction: "approve",
                lineItemReviewedBy: managerId,
                lineItemReviewedAt: new Date("2026-07-27T12:00:00.000Z"),
            },
        ]);

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/submission-detail`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            id: reportId,
            rejectionReason: "Receipt does not match the submitted amount.",
            lineItems: [{ id: lineItemId, reviewAction: "reject" }],
            mileageEntries: [{ id: mileageEntryId, reviewAction: "approve" }],
        });

        const listResponse = await requestApp(
            "/v1/expense-reports/my-submissions",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );

        expect(listResponse.status).toBe(200);
        await expect(listResponse.json()).resolves.toMatchObject({
            items: [{ id: reportId, isSentBack: true }],
        });
    });

    void test("sends a report back when the employee already has another draft", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000695";
        const ownerId = "50000000-0000-4000-8000-000000000695";
        const managerId = "51000000-0000-4000-8000-000000000695";
        const activeDraftId = "60000000-0000-4000-8000-000000000695";
        const reportId = "61000000-0000-4000-8000-000000000695";
        await db.insert(expenseReport).values([
            {
                id: activeDraftId,
                tenantId,
                owner: ownerId,
                dueDate: "2026-08-01",
                currentStage: "Drafted",
            },
            {
                id: reportId,
                tenantId,
                owner: ownerId,
                dueDate: "2026-08-01",
                currentStage: "Manager Approval",
            },
        ]);

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "Drafted",
                    reason: "Receipt correction required.",
                }),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            id: reportId,
            currentStage: "Drafted",
        });

        const draftedReports = await db
            .select({
                id: expenseReport.id,
                currentStage: expenseReport.currentStage,
            })
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, tenantId),
                    eq(expenseReport.owner, ownerId),
                    eq(expenseReport.currentStage, "Drafted"),
                ),
            );

        expect(draftedReports).toEqual(
            expect.arrayContaining([
                { id: activeDraftId, currentStage: "Drafted" },
                { id: reportId, currentStage: "Drafted" },
            ]),
        );

        const currentDraftResponse = await requestApp(
            "/v1/expense-reports/drafts/current",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );

        expect(currentDraftResponse.status).toBe(200);
        await expect(currentDraftResponse.json()).resolves.toMatchObject({
            id: activeDraftId,
            currentStage: "Drafted",
        });
    });

    void test("returns 404 for another employee or tenant submission detail", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000830";
        const otherTenantId = "40000000-0000-4000-8000-000000000831";
        const ownerId = "50000000-0000-4000-8000-000000000830";
        const otherOwnerId = "50000000-0000-4000-8000-000000000831";
        const reportId = "60000000-0000-4000-8000-000000000830";
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-08-01",
            currentStage: "Submitted",
        });

        const otherOwnerResponse = await requestApp(
            `/v1/expense-reports/${reportId}/submission-detail`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, otherOwnerId),
                },
            },
        );
        const otherTenantResponse = await requestApp(
            `/v1/expense-reports/${reportId}/submission-detail`,
            {
                headers: {
                    authorization: authorizationHeader(otherTenantId, ownerId),
                },
            },
        );

        expect(otherOwnerResponse.status).toBe(404);
        expect(otherTenantResponse.status).toBe(404);
    });

    void test("returns 403 for internal roles reading employee submission detail", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000840";
        const internalUserId = "50000000-0000-4000-8000-000000000840";
        const response = await requestApp(
            "/v1/expense-reports/60000000-0000-4000-8000-000000000840/submission-detail",
            {
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        internalUserId,
                        ["Finance Admin"],
                    ),
                },
            },
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            title: "Forbidden",
            status: 403,
        });
    });

    void test("returns 400 for a malformed submission detail identifier", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000850";
        const ownerId = "50000000-0000-4000-8000-000000000850";
        const response = await requestApp(
            "/v1/expense-reports/not-a-uuid/submission-detail",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, ownerId),
                },
            },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            title: "Bad Request",
            status: 400,
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
        expect(idempotencyStoreMock.acquireLock).not.toHaveBeenCalled();
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
            expenseDate: "2026-07-20",
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
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

    void test("adds employee line items and receipt references idempotently", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000129";
        const owner = "50000000-0000-4000-8000-000000000129";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-129",
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

        const request = {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-content-129",
            },
            body: JSON.stringify({
                lineItems: [
                    {
                        merchant: "Synthetic Conference Center",
                        expenseDate: "2026-07-23",
                        category: "Travel",
                        amount: 125.5,
                        currency: "USD",
                    },
                ],
                receipts: [
                    {
                        lineItemIndex: 0,
                        uploadId: "30000000-0000-4000-8000-000000000129",
                        filename: "synthetic-receipt.pdf",
                        contentType: "application/pdf",
                        sizeBytes: 2048,
                    },
                ],
            }),
        } satisfies RequestInit;

        const firstResponse = await requestApp(
            `/v1/expense-reports/${created.id}/draft-content`,
            request,
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const replayResponse = await requestApp(
            `/v1/expense-reports/${created.id}/draft-content`,
            request,
        );
        const [lineItemRows, receiptRows, attachmentRows] = await Promise.all([
            db
                .select()
                .from(lineItem)
                .where(eq(lineItem.expenseReportId, created.id)),
            db
                .select()
                .from(receiptMetadata)
                .where(eq(receiptMetadata.expenseReportId, created.id)),
            db
                .select()
                .from(attachmentMetadata)
                .where(eq(attachmentMetadata.expenseReportId, created.id)),
        ]);

        expect(firstResponse.status).toBe(201);
        expect(replayResponse.status).toBe(201);
        expect(await replayResponse.json()).toStrictEqual(
            await firstResponse.json(),
        );
        expect(lineItemRows).toHaveLength(1);
        expect(lineItemRows[0]?.expenseDate).toBe("2026-07-23");
        expect(receiptRows).toHaveLength(1);
        expect(receiptRows[0]?.lineItemId).toBe(lineItemRows[0]?.id);
        expect(attachmentRows).toHaveLength(1);

        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const contentResponse = await requestApp(
            `/v1/expense-reports/${created.id}/draft-content`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
        const savedContent = (await contentResponse.json()) as {
            lineItems?: Array<{ merchant?: string; expenseDate?: string }>;
            receipts?: Array<{ filename?: string }>;
            mileageEntries?: unknown[];
        };

        expect(contentResponse.status).toBe(200);
        expect(savedContent.lineItems).toEqual([
            expect.objectContaining({
                merchant: "Synthetic Conference Center",
                expenseDate: "2026-07-23",
            }),
        ]);
        expect(savedContent.receipts).toEqual([
            expect.objectContaining({
                filename: "synthetic-receipt.pdf",
            }),
        ]);
        expect(savedContent.mileageEntries).toEqual([]);
    });

    void test("lets an employee update and delete entries in a selected draft", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000144";
        const owner = "50000000-0000-4000-8000-000000000144";
        const otherOwner = "51000000-0000-4000-8000-000000000144";
        const reportId = "60000000-0000-4000-8000-000000000144";
        const lineItemId = "70000000-0000-4000-8000-000000000144";
        const mileageEntryId = "71000000-0000-4000-8000-000000000144";
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-25",
            currentStage: "Drafted",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Cafe",
            expenseDate: "2026-07-20",
            category: "Meals",
            amount: "12.00",
            currency: "USD",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Synthetic Office to Site A",
            distance: "10.00",
            mileageDate: "2026-07-20",
        });

        const deniedUpdate = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, otherOwner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    merchant: "Synthetic Updated Cafe",
                    expenseDate: "2026-07-21",
                    category: "Meals",
                    amount: 18.5,
                    currency: "USD",
                }),
            },
        );
        expect(deniedUpdate.status).toBe(404);
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const lineUpdate = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    merchant: "Synthetic Updated Cafe",
                    expenseDate: "2026-07-21",
                    category: "Meals",
                    amount: 18.5,
                    currency: "USD",
                }),
            },
        );
        expect(lineUpdate.status).toBe(200);
        await expect(lineUpdate.json()).resolves.toMatchObject({
            lineItems: [
                {
                    id: lineItemId,
                    merchant: "Synthetic Updated Cafe",
                    amount: 18.5,
                },
            ],
        });
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const mileageUpdate = await requestApp(
            `/v1/expense-reports/${reportId}/mileage-entries/${mileageEntryId}`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    route: "Synthetic Office to Site B",
                    distance: 14.25,
                    mileageDate: "2026-07-21",
                }),
            },
        );
        expect(mileageUpdate.status).toBe(200);
        await expect(mileageUpdate.json()).resolves.toMatchObject({
            mileageEntries: [
                {
                    id: mileageEntryId,
                    route: "Synthetic Office to Site B",
                    distance: 14.25,
                },
            ],
        });
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const lineDelete = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}`,
            {
                method: "DELETE",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
        expect(lineDelete.status).toBe(200);
        await expect(lineDelete.json()).resolves.toMatchObject({
            lineItems: [],
        });
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const mileageDelete = await requestApp(
            `/v1/expense-reports/${reportId}/mileage-entries/${mileageEntryId}`,
            {
                method: "DELETE",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
        expect(mileageDelete.status).toBe(200);
        await expect(mileageDelete.json()).resolves.toMatchObject({
            mileageEntries: [],
        });
    });

    void test("rejects future mileage dates from API clients", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000143";
        const owner = "50000000-0000-4000-8000-000000000143";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-143",
            },
            body: JSON.stringify({
                owner,
                dueDate: "2026-08-25",
            }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }
        const response = await requestApp(
            `/v1/expense-reports/${created.id}/mileage-entries`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    route: "Synthetic Office → Synthetic Client Site",
                    distance: 12.5,
                    mileageDate: "2999-01-01",
                }),
            },
        );
        const rows = await db
            .select()
            .from(mileageEntry)
            .where(eq(mileageEntry.expenseReportId, created.id));
        const responseBody = (await response.json()) as {
            detail?: string;
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(400);
        expect(responseBody).toMatchObject({
            status: 400,
            title: "Bad Request",
        });
        expect(responseBody.detail).toContain(
            "Mileage date cannot be in the future.",
        );
        expect(rows).toHaveLength(0);
    });

    void test("uploads actual receipt bytes for an employee-owned draft", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000145";
        const owner = "50000000-0000-4000-8000-000000000145";
        const uploadId = "30000000-0000-4000-8000-000000000145";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-145",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-25" }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/receipt-uploads/${uploadId}?filename=synthetic-receipt.pdf`,
            {
                method: "PUT",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/pdf",
                },
                body: new Blob(["synthetic receipt"]),
            },
        );
        const responseBody = (await response.json()) as {
            contentType?: string;
            filename?: string;
            sizeBytes?: number;
            uploadId?: string;
        };

        expect(response.status).toBe(201);
        expect(responseBody).toEqual({
            contentType: "application/pdf",
            filename: "synthetic-receipt.pdf",
            sizeBytes: 17,
            uploadId,
        });
        expect(receiptStorageMock.put).toHaveBeenCalledWith(
            {
                contentType: "application/pdf",
                expenseReportId: created.id,
                sizeBytes: 17,
                tenantId,
                uploadId,
            },
            expect.any(Buffer),
        );
    });

    void test("deduplicates retried mileage additions", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000146";
        const owner = "50000000-0000-4000-8000-000000000146";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-146",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-25" }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }
        const request = {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "mileage-create-146",
            },
            body: JSON.stringify({
                route: "Synthetic Office → Synthetic Client Site",
                distance: 12.5,
                mileageDate: "2026-07-24",
            }),
        } satisfies RequestInit;

        const firstResponse = await requestApp(
            `/v1/expense-reports/${created.id}/mileage-entries`,
            request,
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const replayResponse = await requestApp(
            `/v1/expense-reports/${created.id}/mileage-entries`,
            request,
        );
        const firstBody = (await firstResponse.json()) as unknown;
        const replayBody = (await replayResponse.json()) as unknown;
        const rows = await db
            .select()
            .from(mileageEntry)
            .where(eq(mileageEntry.expenseReportId, created.id));

        expect(firstResponse.status).toBe(201);
        expect(replayResponse.status).toBe(201);
        expect(replayBody).toStrictEqual(firstBody);
        expect(rows).toHaveLength(1);
    });

    void test("requires an Idempotency-Key header for mileage additions", async () => {
        const response = await requestApp(
            "/v1/expense-reports/60000000-0000-4000-8000-000000000146/mileage-entries",
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        "40000000-0000-4000-8000-000000000249",
                        "50000000-0000-4000-8000-000000000249",
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    route: "Synthetic route",
                    distance: 10,
                    mileageDate: "2026-07-24",
                }),
            },
        );

        expect(response.status).toBe(400);
    });

    void test("rejects future expense dates from API clients", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000147";
        const owner = "50000000-0000-4000-8000-000000000147";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-147",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-25" }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/draft-content`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-content-147",
                },
                body: JSON.stringify({
                    lineItems: [
                        {
                            merchant: "Synthetic Air",
                            expenseDate: "2999-01-01",
                            category: "Travel",
                            amount: 125.5,
                            currency: "USD",
                        },
                    ],
                    receipts: [],
                }),
            },
        );
        const rows = await db
            .select()
            .from(lineItem)
            .where(eq(lineItem.expenseReportId, created.id));

        expect(response.status).toBe(400);
        expect(rows).toHaveLength(0);
    });

    void test("creates distinct drafts for the same employee", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000148";
        const owner = "50000000-0000-4000-8000-000000000148";
        const create = (idempotencyKey: string) =>
            requestApp("/v1/expense-reports", {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": idempotencyKey,
                },
                body: JSON.stringify({ owner, dueDate: "2026-08-25" }),
            });

        const firstResponse = await create("expense-create-148-a");
        const firstBody = (await firstResponse.json()) as { id?: string };
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const secondResponse = await create("expense-create-148-b");
        const secondBody = (await secondResponse.json()) as { id?: string };
        const rows = await db
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, tenantId),
                    eq(expenseReport.owner, owner),
                    eq(expenseReport.currentStage, "Drafted"),
                ),
            );

        expect(firstResponse.status).toBe(201);
        expect(secondResponse.status).toBe(201);
        expect(secondBody.id).not.toBe(firstBody.id);
        expect(rows).toHaveLength(2);
    });

    void test("isolates employee draft content, mileage, and receipt uploads by owner and tenant", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000149";
        const otherTenantId = "40000000-0000-4000-8000-000000000150";
        const owner = "50000000-0000-4000-8000-000000000149";
        const otherOwner = "50000000-0000-4000-8000-000000000150";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-149",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-25" }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        for (const [requestTenantId, requestOwner] of [
            [tenantId, otherOwner],
            [otherTenantId, owner],
        ] as const) {
            await db
                .delete(tenantRateLimitWindow)
                .where(eq(tenantRateLimitWindow.tenantId, requestTenantId));
            const currentDraftResponse = await requestApp(
                "/v1/expense-reports/drafts/current",
                {
                    headers: {
                        authorization: authorizationHeader(
                            requestTenantId,
                            requestOwner,
                        ),
                    },
                },
            );
            await db
                .delete(tenantRateLimitWindow)
                .where(eq(tenantRateLimitWindow.tenantId, requestTenantId));
            const contentResponse = await requestApp(
                `/v1/expense-reports/${created.id}/draft-content`,
                {
                    headers: {
                        authorization: authorizationHeader(
                            requestTenantId,
                            requestOwner,
                        ),
                    },
                },
            );
            await db
                .delete(tenantRateLimitWindow)
                .where(eq(tenantRateLimitWindow.tenantId, requestTenantId));
            const addContentResponse = await requestApp(
                `/v1/expense-reports/${created.id}/draft-content`,
                {
                    method: "POST",
                    headers: {
                        authorization: authorizationHeader(
                            requestTenantId,
                            requestOwner,
                        ),
                        "content-type": "application/json",
                        "idempotency-key": `content-isolation-${requestTenantId}`,
                    },
                    body: JSON.stringify({
                        lineItems: [
                            {
                                merchant: "Synthetic Air",
                                expenseDate: "2026-07-24",
                                category: "Travel",
                                amount: 125,
                                currency: "USD",
                            },
                        ],
                        receipts: [
                            {
                                lineItemIndex: 0,
                                uploadId:
                                    "30000000-0000-4000-8000-000000000149",
                                filename: "synthetic-receipt.pdf",
                                contentType: "application/pdf",
                                sizeBytes: 17,
                            },
                        ],
                    }),
                },
            );
            await db
                .delete(tenantRateLimitWindow)
                .where(eq(tenantRateLimitWindow.tenantId, requestTenantId));
            const mileageResponse = await requestApp(
                `/v1/expense-reports/${created.id}/mileage-entries`,
                {
                    method: "POST",
                    headers: {
                        authorization: authorizationHeader(
                            requestTenantId,
                            requestOwner,
                        ),
                        "content-type": "application/json",
                        "idempotency-key": `mileage-isolation-${requestTenantId}`,
                    },
                    body: JSON.stringify({
                        route: "Synthetic route",
                        distance: 10,
                        mileageDate: "2026-07-24",
                    }),
                },
            );
            await db
                .delete(tenantRateLimitWindow)
                .where(eq(tenantRateLimitWindow.tenantId, requestTenantId));
            const receiptResponse = await requestApp(
                `/v1/expense-reports/${created.id}/receipt-uploads/30000000-0000-4000-8000-000000000149?filename=synthetic-receipt.pdf`,
                {
                    method: "PUT",
                    headers: {
                        authorization: authorizationHeader(
                            requestTenantId,
                            requestOwner,
                        ),
                        "content-type": "application/pdf",
                    },
                    body: new Blob(["synthetic receipt"]),
                },
            );

            expect(currentDraftResponse.status).toBe(404);
            expect(contentResponse.status).toBe(404);
            expect(addContentResponse.status).toBe(404);
            expect(mileageResponse.status).toBe(404);
            expect(receiptResponse.status).toBe(404);
        }

        expect(receiptStorageMock.put).not.toHaveBeenCalled();
        expect(receiptStorageMock.verify).not.toHaveBeenCalled();
        expect(
            await db
                .select()
                .from(mileageEntry)
                .where(eq(mileageEntry.expenseReportId, created.id)),
        ).toHaveLength(0);
    });

    void test("allows an Employee to submit their own Drafted report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000132";
        const owner = "50000000-0000-4000-8000-000000000132";
        const correlationId = "70000000-0000-4000-8000-000000000132";
        const replayCorrelationId = "70000000-0000-4000-8000-000000000133";
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

        const sourceId = "30000000-0000-4000-8000-000000000132";
        await db.insert(lineItem).values({
            id: sourceId,
            tenantId,
            expenseReportId: created.id,
            merchant: "Synthetic Rail",
            expenseDate: "2026-07-23",
            amount: "42.00",
            currency: "USD",
            category: "Travel",
        });
        glCodingClientMock.mockResolvedValueOnce({
            coded_items: [
                {
                    source_id: sourceId,
                    source_type: "line_item",
                    category: "Travel",
                    mapping_status: "mapped",
                    gl_account: {
                        account_code: "6000",
                        account_name: "Travel Expense",
                    },
                    amount: "42.00",
                    currency: "USD",
                    flagged_line_item: false,
                },
            ],
            flags: [],
        });
        stageTransitionPublishMock.mockRejectedValueOnce(
            new Error("synthetic SNS failure"),
        );
        einValidationAclValidateMock.mockResolvedValueOnce({
            status: "invalid",
            isValid: false,
            rejectionReason: "Synthetic EIN and legal name mismatch.",
            serviceReferenceId: "synthetic-reference-invalid-132",
        });

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-132",
                    "x-correlation-id": correlationId,
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );

        const body = (await response.json()) as { currentStage?: string };
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const replayResponse = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-132",
                    "x-correlation-id": replayCorrelationId,
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );
        const replayBody = (await replayResponse.json()) as {
            currentStage?: string;
        };
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        expect(response.status).toBe(201);
        expect(replayResponse.status).toBe(201);
        expect(response.headers.get("x-correlation-id")).toBe(correlationId);
        expect(replayResponse.headers.get("x-correlation-id")).toBe(
            correlationId,
        );
        expect(body.currentStage).toBe("Submitted");
        expect(replayBody.currentStage).toBe("Submitted");
        expect(glCodingClientMock).toHaveBeenCalledOnce();
        expect(stageTransitionPublishMock).toHaveBeenCalledOnce();
        expect(stageTransitionPublishMock).toHaveBeenCalledWith(
            expect.objectContaining({
                caseId: created.id,
                tenantId,
                fromStage: "Drafted",
                toStage: "Submitted",
                correlationId,
            }),
        );
        const outboxRows = await db
            .select()
            .from(stageTransitionOutbox)
            .where(eq(stageTransitionOutbox.expenseReportId, created.id));
        expect(outboxRows).toHaveLength(1);
        expect(outboxRows[0]).toMatchObject({
            attemptCount: 1,
            idempotencyKey: "expense-submit-132",
            publishedAt: null,
            deadLetteredAt: null,
        });
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, created.id),
                ),
            );
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, created.id));
        expect(auditRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: "transition_approved",
                    stageBeforeAction: "Drafted",
                    stageAfterProposedAction: "Submitted",
                }),
            ]),
        );
        const employerValidationAudit = auditRows.find(
            (row) => row.action === "employer_ein_validated",
        );
        expect(employerValidationAudit).toMatchObject({
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Submitted",
            outcomeReason: JSON.stringify({
                status: "invalid",
                reason: "Synthetic EIN and legal name mismatch.",
                serviceReferenceId: "synthetic-reference-invalid-132",
            }),
        });
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                actor: owner,
                fromStage: "Drafted",
                toStage: "Submitted",
                reason: "report_submitted",
            }),
        );
    });

    void test("recovers a committed submission when saving its idempotency result fails", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000232";
        const owner = "50000000-0000-4000-8000-000000000232";
        const correlationId = "70000000-0000-4000-8000-000000000232";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-232",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-12" }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        const sourceId = "30000000-0000-4000-8000-000000000232";
        await db.insert(lineItem).values({
            id: sourceId,
            tenantId,
            expenseReportId: created.id,
            merchant: "Synthetic Transit",
            expenseDate: "2026-07-24",
            amount: "18.50",
            currency: "USD",
            category: "Travel",
        });
        glCodingClientMock.mockResolvedValueOnce({
            coded_items: [
                {
                    source_id: sourceId,
                    source_type: "line_item",
                    category: "Travel",
                    mapping_status: "mapped",
                    gl_account: {
                        account_code: "6000",
                        account_name: "Travel Expense",
                    },
                    amount: "18.50",
                    currency: "USD",
                    flagged_line_item: false,
                },
            ],
            flags: [],
        });
        idempotencyStoreMock.saveResult.mockRejectedValueOnce(
            new Error("synthetic idempotency result storage failure"),
        );

        const firstResponse = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-232",
                    "x-correlation-id": correlationId,
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const replayResponse = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-232",
                    "x-correlation-id": "70000000-0000-4000-8000-000000000233",
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );
        const replayBody = (await replayResponse.json()) as {
            currentStage?: string;
        };
        const outboxRows = await db
            .select()
            .from(stageTransitionOutbox)
            .where(eq(stageTransitionOutbox.expenseReportId, created.id));

        expect(firstResponse.status).toBe(500);
        expect(replayResponse.status).toBe(201);
        expect(replayResponse.headers.get("x-correlation-id")).toBe(
            correlationId,
        );
        expect(replayBody.currentStage).toBe("Submitted");
        expect(glCodingClientMock).toHaveBeenCalledOnce();
        expect(stageTransitionPublishMock).toHaveBeenCalledOnce();
        expect(outboxRows).toHaveLength(1);
        expect(outboxRows[0]).toMatchObject({
            correlationId,
            idempotencyKey: "expense-submit-232",
            fromStage: "Drafted",
            toStage: "Submitted",
        });
        expect(outboxRows[0]?.publishedAt).toBeInstanceOf(Date);
    });

    void test("rejects an empty Drafted Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000745";
        const owner = "50000000-0000-4000-8000-000000000745";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-745",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-12" }),
        });
        const created = (await createResponse.json()) as { id?: string };
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const response = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-745",
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );

        expect(response.status).toBe(409);
        const responseBody = (await response.json()) as {
            detail?: string;
            title?: string;
        };
        expect(responseBody).toMatchObject({
            detail: "Add at least one expense or mileage entry before submitting.",
            title: "Conflict",
        });
        expect(glCodingClientMock).not.toHaveBeenCalled();
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );

        expect(response.status).toBe(400);
        expect(idempotencyStoreMock.acquireLock).not.toHaveBeenCalled();
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
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
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );

        expect(response.status).toBe(409);
        expect(glCodingClientMock).not.toHaveBeenCalled();
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, created.id ?? ""),
                ),
            );
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, created.id ?? ""));
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
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "Submitted",
                toStage: "Submitted",
                reason: "transition_denied: Only Drafted Expense Reports can be submitted.",
            }),
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

        await db.insert(lineItem).values({
            tenantId,
            expenseReportId: created.id,
            merchant: "Synthetic Air",
            expenseDate: "2026-07-23",
            amount: "125.00",
            currency: "USD",
            category: "Travel",
        });
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
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
            expenseDate: "2026-07-20",
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
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
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

    void test("rejects Employee workflow transition attempts with audit and transition logs", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000150";
        const owner = "50000000-0000-4000-8000-000000000150";
        const reportId = "60000000-0000-4000-8000-000000000150";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-15",
            currentStage: "Submitted",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "Manager Approval",
                    reason: "employee attempted transition",
                }),
            },
        );
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };
        const reportRows = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(403);
        expect(body).toMatchObject({ title: "Forbidden", status: 403 });
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
        expect(reportRows[0]?.currentStage).toBe("Submitted");
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                actorId: owner,
                action: "transition_denied",
                stageBeforeAction: "Submitted",
                stageAfterProposedAction: "Manager Approval",
                denialReason:
                    "Authenticated role is not permitted to transition Expense Reports.",
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                actor: owner,
                fromStage: "Submitted",
                toStage: "Submitted",
                reason: "transition_denied: Authenticated role is not permitted to transition Expense Reports.",
            }),
        );
    });

    void test("does not publish an event for an invalid workflow edge", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000234";
        const owner = "50000000-0000-4000-8000-000000000234";
        const managerId = "51000000-0000-4000-8000-000000000234";
        const reportId = "60000000-0000-4000-8000-000000000234";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-15",
            currentStage: "Submitted",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "synthetic invalid edge attempt",
                }),
            },
        );
        const outboxRows = await db
            .select()
            .from(stageTransitionOutbox)
            .where(eq(stageTransitionOutbox.expenseReportId, reportId));

        expect(response.status).toBe(409);
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
        expect(outboxRows).toHaveLength(0);
    });

    void test("rejects settlement-owned edges on the generic transition route", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000235";
        const owner = "50000000-0000-4000-8000-000000000235";
        const financeAdminId = "52000000-0000-4000-8000-000000000235";
        const reportId = "60000000-0000-4000-8000-000000000235";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-15",
            currentStage: "AP Review",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
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
                    toStage: "Paid",
                    reason: "synthetic generic payment attempt",
                }),
            },
        );
        const [persistedReport] = await db
            .select()
            .from(expenseReport)
            .where(
                and(
                    eq(expenseReport.tenantId, tenantId),
                    eq(expenseReport.id, reportId),
                ),
            );
        const settlementRows = await db
            .select()
            .from(expenseReportSettlement)
            .where(
                and(
                    eq(expenseReportSettlement.tenantId, tenantId),
                    eq(expenseReportSettlement.expenseReportId, reportId),
                ),
            );
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, reportId),
                ),
            );
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(
                and(
                    eq(stageTransition.tenantId, tenantId),
                    eq(stageTransition.expenseReportId, reportId),
                ),
            );

        expect(response.status).toBe(409);
        expect(persistedReport?.currentStage).toBe("AP Review");
        expect(settlementRows).toHaveLength(0);
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "transition_denied",
                stageBeforeAction: "AP Review",
                stageAfterProposedAction: "Paid",
                denialReason:
                    "Settlement-owned transition must use the settlement route.",
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "AP Review",
                toStage: "AP Review",
                reason: "transition_denied: Settlement-owned transition must use the settlement route.",
            }),
        );
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
    });

    void test("allows Department Manager and Finance Admin workflow transitions", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000151";
        const owner = "50000000-0000-4000-8000-000000000151";
        const managerId = "51000000-0000-4000-8000-000000000151";
        const financeAdminId = "52000000-0000-4000-8000-000000000151";
        const reportId = "60000000-0000-4000-8000-000000000151";
        const managerCorrelationId = "70000000-0000-4000-8000-000000000151";
        const financeCorrelationId = "70000000-0000-4000-8000-000000000152";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-16",
            currentStage: "Submitted",
        });

        const managerResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                    "x-correlation-id": managerCorrelationId,
                },
                body: JSON.stringify({
                    toStage: "Manager Approval",
                    reason: "manager review started",
                }),
            },
        );
        const financeResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                    "x-correlation-id": financeCorrelationId,
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "manager approved",
                }),
            },
        );
        const financeBody = (await financeResponse.json()) as {
            currentStage?: string;
        };

        expect(managerResponse.status).toBe(200);
        expect(managerResponse.headers.get("x-correlation-id")).toBe(
            managerCorrelationId,
        );
        expect(financeResponse.status).toBe(200);
        expect(financeBody.currentStage).toBe("AP Review");
        expect(stageTransitionPublishMock).toHaveBeenCalledTimes(2);
        expect(stageTransitionPublishMock).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                caseId: reportId,
                tenantId,
                fromStage: "Submitted",
                toStage: "Manager Approval",
                correlationId: managerCorrelationId,
            }),
        );
        expect(stageTransitionPublishMock).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                caseId: reportId,
                tenantId,
                fromStage: "Manager Approval",
                toStage: "AP Review",
                correlationId: financeCorrelationId,
            }),
        );
    });

    void test("settles an AP Review report idempotently and replays the original correlation", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000210";
        const owner = "50000000-0000-4000-8000-000000000210";
        const financeAdminId = "51000000-0000-4000-8000-000000000210";
        const reportId = "60000000-0000-4000-8000-000000000210";
        const correlationId = "70000000-0000-4000-8000-000000000210";
        const replayCorrelationId = "70000000-0000-4000-8000-000000000211";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-18",
            currentStage: "AP Review",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/settlement`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-settle-210",
                    "x-correlation-id": correlationId,
                },
                body: JSON.stringify({
                    reason: "synthetic settlement complete",
                }),
            },
        );
        const body = (await response.json()) as { currentStage?: string };
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));

        const replayResponse = await requestApp(
            `/v1/expense-reports/${reportId}/settlement`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        tenantId,
                        financeAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                    "idempotency-key": "expense-settle-210",
                    "x-correlation-id": replayCorrelationId,
                },
                body: JSON.stringify({
                    reason: "synthetic settlement complete",
                }),
            },
        );
        const replayBody = (await replayResponse.json()) as {
            currentStage?: string;
        };
        const settlementRows = await db
            .select()
            .from(expenseReportSettlement)
            .where(eq(expenseReportSettlement.expenseReportId, reportId));
        const outboxRows = await db
            .select()
            .from(stageTransitionOutbox)
            .where(eq(stageTransitionOutbox.expenseReportId, reportId));

        expect(response.status).toBe(200);
        expect(replayResponse.status).toBe(200);
        expect(response.headers.get("x-correlation-id")).toBe(correlationId);
        expect(replayResponse.headers.get("x-correlation-id")).toBe(
            correlationId,
        );
        expect(body.currentStage).toBe("Reconciled");
        expect(replayBody.currentStage).toBe("Reconciled");
        expect(settlementRows).toHaveLength(1);
        expect(settlementRows[0]).toMatchObject({
            tenantId,
            expenseReportId: reportId,
            idempotencyKey: "expense-settle-210",
            correlationId,
            status: "reconciled",
        });
        expect(settlementRows[0]?.paymentId).toMatch(/^synthetic-payment-/);
        expect(outboxRows).toHaveLength(2);
        expect(outboxRows).toContainEqual(
            expect.objectContaining({
                tenantId,
                expenseReportId: reportId,
                idempotencyKey: "expense-settle-210",
                fromStage: "AP Review",
                toStage: "Paid",
            }),
        );
        expect(outboxRows).toContainEqual(
            expect.objectContaining({
                tenantId,
                expenseReportId: reportId,
                idempotencyKey: "expense-settle-210",
                fromStage: "Paid",
                toStage: "Reconciled",
            }),
        );
    });

    void test("compensates with a first-class transition when settlement reconciliation fails", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000212";
        const owner = "50000000-0000-4000-8000-000000000212";
        const financeAdminId = "51000000-0000-4000-8000-000000000212";
        const reportId = "60000000-0000-4000-8000-000000000212";
        const correlationId = "70000000-0000-4000-8000-000000000212";
        const triggerName = "fail_paid_reconciled_212";
        const functionName = "fail_paid_reconciled_212_fn";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-18",
            currentStage: "AP Review",
        });
        await db.execute(
            sql.raw(`
CREATE OR REPLACE FUNCTION ${functionName}()
RETURNS trigger AS $$
BEGIN
    IF NEW."from_stage" = 'Paid' AND NEW."to_stage" = 'Reconciled' THEN
        RAISE EXCEPTION 'synthetic reconciliation transition failure';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ${triggerName}
BEFORE INSERT ON "stage_transition"
FOR EACH ROW EXECUTE FUNCTION ${functionName}();
`),
        );

        try {
            const response = await requestApp(
                `/v1/expense-reports/${reportId}/settlement`,
                {
                    method: "POST",
                    headers: {
                        authorization: authorizationHeader(
                            tenantId,
                            financeAdminId,
                            ["Finance Admin"],
                        ),
                        "content-type": "application/json",
                        "idempotency-key": "expense-settle-212",
                        "x-correlation-id": correlationId,
                    },
                    body: JSON.stringify({}),
                },
            );
            const [persistedReport] = await db
                .select()
                .from(expenseReport)
                .where(eq(expenseReport.id, reportId));
            const auditRows = await db
                .select()
                .from(auditEntry)
                .where(eq(auditEntry.expenseReportId, reportId));
            const transitionRows = await db
                .select()
                .from(stageTransition)
                .where(eq(stageTransition.expenseReportId, reportId));
            const outboxRows = await db
                .select()
                .from(stageTransitionOutbox)
                .where(eq(stageTransitionOutbox.expenseReportId, reportId));
            const settlementRows = await db
                .select()
                .from(expenseReportSettlement)
                .where(eq(expenseReportSettlement.expenseReportId, reportId));

            expect(response.status).toBe(409);
            expect(persistedReport?.currentStage).toBe("AP Review");
            expect(settlementRows).toContainEqual(
                expect.objectContaining({
                    tenantId,
                    expenseReportId: reportId,
                    idempotencyKey: "expense-settle-212",
                    status: "compensated",
                }),
            );
            expect(auditRows).toContainEqual(
                expect.objectContaining({
                    action: "payment_stub_issued",
                    stageBeforeAction: "AP Review",
                    stageAfterProposedAction: "AP Review",
                }),
            );
            expect(auditRows).toContainEqual(
                expect.objectContaining({
                    action: "settlement_saga_compensated",
                    stageBeforeAction: "Paid",
                    stageAfterProposedAction: "AP Review",
                }),
            );
            expect(transitionRows).toContainEqual(
                expect.objectContaining({
                    fromStage: "AP Review",
                    toStage: "Paid",
                    reason: "payment_stub_issued",
                }),
            );
            expect(transitionRows).not.toContainEqual(
                expect.objectContaining({
                    fromStage: "Paid",
                    toStage: "Reconciled",
                }),
            );
            expect(transitionRows).toContainEqual(
                expect.objectContaining({
                    fromStage: "Paid",
                    toStage: "AP Review",
                    reason: "settlement_saga_compensated",
                }),
            );
            expect(outboxRows).toContainEqual(
                expect.objectContaining({
                    fromStage: "AP Review",
                    toStage: "Paid",
                    correlationId,
                }),
            );
            expect(outboxRows).toContainEqual(
                expect.objectContaining({
                    fromStage: "Paid",
                    toStage: "AP Review",
                    correlationId,
                }),
            );
            expect(outboxRows).not.toContainEqual(
                expect.objectContaining({
                    fromStage: "Paid",
                    toStage: "Reconciled",
                }),
            );
        } finally {
            await db.execute(
                sql.raw(
                    `DROP TRIGGER IF EXISTS ${triggerName} ON "stage_transition"; DROP FUNCTION IF EXISTS ${functionName}();`,
                ),
            );
        }
    });

    void test.each([
        {
            scenario:
                "Department Manager advances Submitted to Manager Approval",
            suffix: "171",
            role: "Department Manager",
            fromStage: "Submitted",
            toStage: "Manager Approval",
        },
        {
            scenario: "Finance Admin advances Submitted to Manager Approval",
            suffix: "172",
            role: "Finance Admin",
            fromStage: "Submitted",
            toStage: "Manager Approval",
        },
        {
            scenario:
                "Department Manager advances Manager Approval to AP Review",
            suffix: "173",
            role: "Department Manager",
            fromStage: "Manager Approval",
            toStage: "AP Review",
        },
        {
            scenario: "Finance Admin advances Manager Approval to AP Review",
            suffix: "174",
            role: "Finance Admin",
            fromStage: "Manager Approval",
            toStage: "AP Review",
        },
    ] satisfies Array<{
        scenario: string;
        suffix: string;
        role: RoleName;
        fromStage: "Submitted" | "Manager Approval";
        toStage: "Manager Approval" | "AP Review";
    }>)("allows $scenario", async ({ suffix, role, fromStage, toStage }) => {
        const tenantId = `40000000-0000-4000-8000-000000000${suffix}`;
        const owner = `50000000-0000-4000-8000-000000000${suffix}`;
        const actorId = `51000000-0000-4000-8000-000000000${suffix}`;
        const reportId = `60000000-0000-4000-8000-000000000${suffix}`;
        const reason = `${role} approved transition`;

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-22",
            currentStage: fromStage,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, actorId, [
                        role,
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage,
                    reason,
                }),
            },
        );
        const body = (await response.json()) as { currentStage?: string };
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(200);
        expect(body.currentStage).toBe(toStage);
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                actorId,
                action: "transition_approved",
                stageBeforeAction: fromStage,
                stageAfterProposedAction: toStage,
                denialReason: null,
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                actor: actorId,
                fromStage,
                toStage,
                reason,
            }),
        );
    });

    void test.each([
        {
            scenario:
                "Department Manager sends Manager Approval back to Drafted",
            suffix: "175",
            role: "Department Manager",
            fromStage: "Manager Approval",
        },
        {
            scenario: "Finance Admin sends Manager Approval back to Drafted",
            suffix: "176",
            role: "Finance Admin",
            fromStage: "Manager Approval",
        },
        {
            scenario: "Department Manager sends AP Review back to Drafted",
            suffix: "177",
            role: "Department Manager",
            fromStage: "AP Review",
        },
        {
            scenario: "Finance Admin sends AP Review back to Drafted",
            suffix: "178",
            role: "Finance Admin",
            fromStage: "AP Review",
        },
    ] satisfies Array<{
        scenario: string;
        suffix: string;
        role: RoleName;
        fromStage: "Manager Approval" | "AP Review";
    }>)("allows $scenario", async ({ suffix, role, fromStage }) => {
        const tenantId = `40000000-0000-4000-8000-000000000${suffix}`;
        const owner = `50000000-0000-4000-8000-000000000${suffix}`;
        const actorId = `51000000-0000-4000-8000-000000000${suffix}`;
        const reportId = `60000000-0000-4000-8000-000000000${suffix}`;
        const reason = `${role} sent back for correction`;

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-23",
            currentStage: fromStage,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, actorId, [
                        role,
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "Drafted",
                    reason,
                }),
            },
        );
        const body = (await response.json()) as { currentStage?: string };
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(200);
        expect(body.currentStage).toBe("Drafted");
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                actorId,
                action: "transition_sent_back",
                stageBeforeAction: fromStage,
                stageAfterProposedAction: "Drafted",
                denialReason: null,
                outcomeReason: reason,
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                actor: actorId,
                fromStage,
                toStage: "Drafted",
                reason,
            }),
        );
    });

    void test.each([
        {
            scenario: "Employee cannot advance Submitted to Manager Approval",
            suffix: "179",
            fromStage: "Submitted",
            toStage: "Manager Approval",
        },
        {
            scenario: "Employee cannot advance Manager Approval to AP Review",
            suffix: "180",
            fromStage: "Manager Approval",
            toStage: "AP Review",
        },
        {
            scenario: "Employee cannot send Manager Approval back to Drafted",
            suffix: "181",
            fromStage: "Manager Approval",
            toStage: "Drafted",
        },
        {
            scenario: "Employee cannot send AP Review back to Drafted",
            suffix: "182",
            fromStage: "AP Review",
            toStage: "Drafted",
        },
    ])(
        "denies $scenario with audit and transition logs",
        async ({ suffix, fromStage, toStage }) => {
            const tenantId = `40000000-0000-4000-8000-000000000${suffix}`;
            const owner = `50000000-0000-4000-8000-000000000${suffix}`;
            const reportId = `60000000-0000-4000-8000-000000000${suffix}`;

            await db.insert(expenseReport).values({
                id: reportId,
                tenantId,
                owner,
                dueDate: "2026-08-24",
                currentStage: fromStage,
            });

            const response = await requestApp(
                `/v1/expense-reports/${reportId}/transitions`,
                {
                    method: "POST",
                    headers: {
                        authorization: authorizationHeader(tenantId, owner),
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        toStage,
                        reason: "employee attempted workflow action",
                    }),
                },
            );
            const body = (await response.json()) as {
                title?: string;
                status?: number;
            };
            const reportRows = await db
                .select()
                .from(expenseReport)
                .where(eq(expenseReport.id, reportId));
            const auditRows = await db
                .select()
                .from(auditEntry)
                .where(eq(auditEntry.expenseReportId, reportId));
            const transitionRows = await db
                .select()
                .from(stageTransition)
                .where(eq(stageTransition.expenseReportId, reportId));

            expect(response.status).toBe(403);
            expect(body).toMatchObject({ title: "Forbidden", status: 403 });
            expect(stageTransitionPublishMock).not.toHaveBeenCalled();
            expect(reportRows[0]?.currentStage).toBe(fromStage);
            expect(auditRows).toContainEqual(
                expect.objectContaining({
                    actorId: owner,
                    action: "transition_denied",
                    stageBeforeAction: fromStage,
                    stageAfterProposedAction: toStage,
                    denialReason:
                        "Authenticated role is not permitted to transition Expense Reports.",
                }),
            );
            expect(transitionRows).toContainEqual(
                expect.objectContaining({
                    actor: owner,
                    fromStage,
                    toStage: fromStage,
                    reason: "transition_denied: Authenticated role is not permitted to transition Expense Reports.",
                }),
            );
        },
    );
    void test("blocks Manager Approval until flags are clear and all line items are reviewed", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000152";
        const owner = "50000000-0000-4000-8000-000000000152";
        const managerId = "51000000-0000-4000-8000-000000000152";
        const reportId = "60000000-0000-4000-8000-000000000152";
        const lineItemId = "30000000-0000-4000-8000-000000000152";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Lodge",
            expenseDate: "2026-07-20",
            amount: "642.30",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000152",
            submissionId: "90000000-0000-4000-8000-000000000152",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });

        const blockedResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "manager approved",
                }),
            },
        );
        const deniedAuditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const deniedTransitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(deniedAuditRows).toContainEqual(
            expect.objectContaining({
                action: "transition_denied",
                stageBeforeAction: "Manager Approval",
                stageAfterProposedAction: "AP Review",
                denialReason:
                    "Expense Report has uncleared over-threshold line-item flags.",
            }),
        );
        expect(deniedTransitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "Manager Approval",
                toStage: "Manager Approval",
                reason: "transition_denied: Expense Report has uncleared over-threshold line-item flags.",
            }),
        );
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();

        const clearResponse = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [lineItemId],
                    reason: "reviewed receipt detail",
                }),
            },
        );
        const clearBody = (await clearResponse.json()) as {
            clearedFlagCount?: number;
        };
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const unreviewedAdvanceResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "manager approved after flag review",
                }),
            },
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
        const reviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const advanceResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "manager approved after line-item review",
                }),
            },
        );
        const advanceBody = (await advanceResponse.json()) as {
            currentStage?: string;
        };

        expect(blockedResponse.status).toBe(409);
        expect(clearResponse.status).toBe(200);
        expect(clearBody).toMatchObject({ clearedFlagCount: 1 });
        expect(unreviewedAdvanceResponse.status).toBe(409);
        expect(reviewResponse.status).toBe(200);
        expect(advanceResponse.status).toBe(200);
        expect(advanceBody.currentStage).toBe("AP Review");
    });

    void test("blocks Manager Approval send-back until all line items are reviewed", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000693";
        const owner = "50000000-0000-4000-8000-000000000693";
        const managerId = "51000000-0000-4000-8000-000000000693";
        const reportId = "60000000-0000-4000-8000-000000000693";
        const lineItemId = "30000000-0000-4000-8000-000000000693";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Lodge",
            expenseDate: "2026-07-20",
            amount: "642.30",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000693",
            submissionId: "90000000-0000-4000-8000-000000000693",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            amount: "642.30",
            currency: "USD",
            flaggedLineItem: false,
            lineItemReviewAction: null,
        });

        const sendBackResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "Drafted",
                    reason: "employee correction needed",
                }),
            },
        );
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(sendBackResponse.status).toBe(409);
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "transition_denied",
                stageBeforeAction: "Manager Approval",
                stageAfterProposedAction: "Drafted",
                denialReason:
                    "Expense Report has reviewable sources that have not been reviewed.",
            }),
        );
    });

    void test("reviews a Manager Approval line item and exposes the updated queue row", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000691";
        const owner = "50000000-0000-4000-8000-000000000691";
        const managerId = "51000000-0000-4000-8000-000000000691";
        const reportId = "60000000-0000-4000-8000-000000000691";
        const lineItemId = "30000000-0000-4000-8000-000000000691";
        const mileageEntryId = "32000000-0000-4000-8000-000000000691";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Lodge",
            expenseDate: "2026-07-20",
            amount: "642.30",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Office to client site",
            distance: "18.50",
            mileageDate: "2026-07-21",
        });
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000691",
                submissionId: "90000000-0000-4000-8000-000000000691",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "642.30",
                currency: "USD",
                flaggedLineItem: true,
                flagCode: "line_item_over_threshold",
                flagMessage:
                    "Line item amount is above the MVP manual review threshold.",
            },
            {
                id: "92000000-0000-4000-8000-000000000691",
                submissionId: "90000000-0000-4000-8000-000000000691",
                tenantId,
                expenseReportId: reportId,
                sourceType: "mileage",
                sourceId: mileageEntryId,
                category: "Mileage",
                mappingStatus: "mapped",
                glAccountCode: "6250",
                glAccountName: "Mileage Expense",
                amount: "12.40",
                currency: "USD",
                flaggedLineItem: false,
            },
        ]);

        const reviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    action: "reject",
                    reason: "receipt does not match policy",
                }),
            },
        );
        const reviewBody = (await reviewResponse.json()) as {
            id?: string;
            reviewAction?: string;
            canAdvance?: boolean;
        };
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(reviewResponse.status).toBe(200);
        expect(reviewBody).toMatchObject({
            id: lineItemId,
            reviewAction: "reject",
            canAdvance: false,
        });
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "line_item_rejected",
                stageBeforeAction: "Manager Approval",
                stageAfterProposedAction: "Manager Approval",
                outcomeReason: "receipt does not match policy",
            }),
        );

        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const queueResponse = await requestApp("/v1/case-queue/line-items", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const queueBody = (await queueResponse.json()) as Array<{
            employee?: string;
            id?: string;
            mileageEntries?: unknown[];
            policyChecks?: Array<{
                code?: string;
                message?: string;
                state?: string;
            }>;
            reportTotalMileage?: number;
            reviewAction?: string;
        }>;

        expect(queueResponse.status).toBe(200);
        expect(queueBody).toContainEqual(
            expect.objectContaining({
                employee: owner,
                id: lineItemId,
                policyChecks: [
                    {
                        code: "line_item_over_threshold",
                        message:
                            "Line item amount is above the MVP manual review threshold.",
                        state: "uncleared",
                    },
                ],
                reportTotalMileage: 18.5,
                mileageEntries: [
                    expect.objectContaining({
                        id: mileageEntryId,
                        route: "Office to client site",
                        distance: 18.5,
                        mileageDate: "2026-07-21",
                        amount: 12.4,
                        glCode: "6250",
                    }),
                ],
                reviewAction: "reject",
            }),
        );
    });

    void test("reviews and clears flags for a Manager Approval mileage source", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000694";
        const owner = "50000000-0000-4000-8000-000000000694";
        const managerId = "51000000-0000-4000-8000-000000000694";
        const reportId = "60000000-0000-4000-8000-000000000694";
        const lineItemId = "30000000-0000-4000-8000-000000000694";
        const mileageEntryId = "32000000-0000-4000-8000-000000000694";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Air",
            expenseDate: "2026-07-20",
            amount: "428.50",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Airport to regional office",
            distance: "24.60",
            mileageDate: "2026-07-21",
        });
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000694",
                submissionId: "90000000-0000-4000-8000-000000000694",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6220",
                glAccountName: "Airfare",
                amount: "428.50",
                currency: "USD",
                flaggedLineItem: false,
                lineItemReviewAction: "approve",
                lineItemReviewedBy: managerId,
                lineItemReviewedAt: new Date("2026-07-22T12:00:00.000Z"),
            },
            {
                id: "92000000-0000-4000-8000-000000000694",
                submissionId: "90000000-0000-4000-8000-000000000694",
                tenantId,
                expenseReportId: reportId,
                sourceType: "mileage",
                sourceId: mileageEntryId,
                category: "Mileage",
                mappingStatus: "mapped",
                glAccountCode: "6250",
                glAccountName: "Mileage Expense",
                amount: "15.62",
                currency: "USD",
                flaggedLineItem: true,
                flagCode: "mileage_review",
                flagMessage: "Mileage requires manager review.",
            },
        ]);

        const reviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/sources/mileage/${mileageEntryId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    action: "reject",
                    reason: "mileage route does not match itinerary",
                }),
            },
        );
        const reviewBody = (await reviewResponse.json()) as {
            canAdvance?: boolean;
            mileageEntries?: Array<{
                id?: string;
                flaggedLineItem?: boolean;
                reviewAction?: string;
            }>;
        };
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(reviewResponse.status).toBe(200);
        expect(reviewBody.canAdvance).toBe(false);
        expect(reviewBody.mileageEntries).toContainEqual(
            expect.objectContaining({
                id: mileageEntryId,
                flaggedLineItem: true,
                reviewAction: "reject",
            }),
        );
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "mileage_rejected",
                stageBeforeAction: "Manager Approval",
                stageAfterProposedAction: "Manager Approval",
                outcomeReason: "mileage route does not match itinerary",
            }),
        );

        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const clearResponse = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [mileageEntryId],
                    reason: "mileage review completed",
                }),
            },
        );
        const clearBody = (await clearResponse.json()) as {
            clearedFlagCount?: number;
        };
        const [mileageReviewRow] = await db
            .select({
                flaggedLineItem: glCodingResult.flaggedLineItem,
                reviewAction: glCodingResult.lineItemReviewAction,
                reviewReason: glCodingResult.lineItemReviewReason,
            })
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, tenantId),
                    eq(glCodingResult.sourceType, "mileage"),
                    eq(glCodingResult.sourceId, mileageEntryId),
                ),
            );

        expect(clearResponse.status).toBe(200);
        expect(clearBody).toEqual({ clearedFlagCount: 1 });
        expect(mileageReviewRow).toMatchObject({
            flaggedLineItem: false,
            reviewAction: "reject",
            reviewReason: "mileage route does not match itinerary",
        });
    });

    void test("exposes and reviews a mileage-only Manager Approval report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000195";
        const owner = "50000000-0000-4000-8000-000000000195";
        const managerId = "51000000-0000-4000-8000-000000000195";
        const reportId = "60000000-0000-4000-8000-000000000195";
        const mileageEntryId = "32000000-0000-4000-8000-000000000195";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Office to customer site",
            distance: "42.20",
            mileageDate: "2026-07-21",
        });
        await db.insert(glCodingResult).values({
            id: "92000000-0000-4000-8000-000000000195",
            submissionId: "90000000-0000-4000-8000-000000000195",
            tenantId,
            expenseReportId: reportId,
            sourceType: "mileage",
            sourceId: mileageEntryId,
            category: "Mileage",
            mappingStatus: "mapped",
            glAccountCode: "6250",
            glAccountName: "Mileage Expense",
            amount: "26.80",
            currency: "USD",
            flaggedLineItem: false,
        });

        const queueResponse = await requestApp("/v1/case-queue/line-items", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const queueBody = (await queueResponse.json()) as Array<{
            id?: string;
            sourceType?: string;
            merchant?: string;
            reportTotalMileage?: number;
            mileageEntries?: unknown[];
            canAdvance?: boolean;
        }>;

        expect(queueResponse.status).toBe(200);
        expect(queueBody).toContainEqual(
            expect.objectContaining({
                id: mileageEntryId,
                sourceType: "mileage",
                merchant: "Office to customer site",
                reportTotalMileage: 42.2,
                mileageEntries: [],
                canAdvance: false,
            }),
        );

        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const reviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/sources/mileage/${mileageEntryId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        const reviewBody = (await reviewResponse.json()) as {
            id?: string;
            sourceType?: string;
            reviewAction?: string;
            canAdvance?: boolean;
        };

        expect(reviewResponse.status).toBe(200);
        expect(reviewBody).toMatchObject({
            id: mileageEntryId,
            sourceType: "mileage",
            reviewAction: "approve",
            canAdvance: true,
        });

        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const advanceResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "manager approved mileage-only report",
                }),
            },
        );

        expect(advanceResponse.status).toBe(200);
    });

    void test("excludes Drafted reports from manager queue line items", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000692";
        const owner = "50000000-0000-4000-8000-000000000692";
        const managerId = "51000000-0000-4000-8000-000000000692";
        const draftedReportId = "60000000-0000-4000-8000-000000000692";
        const draftedLineItemId = "30000000-0000-4000-8000-000000000692";
        const reviewReportId = "61000000-0000-4000-8000-000000000692";
        const reviewLineItemId = "31000000-0000-4000-8000-000000000692";

        await db.insert(expenseReport).values([
            {
                id: draftedReportId,
                tenantId,
                owner,
                dueDate: "2026-08-17",
                currentStage: "Drafted",
            },
            {
                id: reviewReportId,
                tenantId,
                owner,
                dueDate: "2026-08-18",
                currentStage: "Manager Approval",
            },
        ]);
        await db.insert(lineItem).values([
            {
                id: draftedLineItemId,
                tenantId,
                expenseReportId: draftedReportId,
                merchant: "Synthetic Drafted Hotel",
                expenseDate: "2026-07-20",
                amount: "642.30",
                currency: "USD",
                category: "Travel",
            },
            {
                id: reviewLineItemId,
                tenantId,
                expenseReportId: reviewReportId,
                merchant: "Synthetic Review Hotel",
                expenseDate: "2026-07-21",
                amount: "712.40",
                currency: "USD",
                category: "Travel",
            },
        ]);
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000692",
                submissionId: "90000000-0000-4000-8000-000000000692",
                tenantId,
                expenseReportId: draftedReportId,
                sourceType: "line_item",
                sourceId: draftedLineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "642.30",
                currency: "USD",
                flaggedLineItem: true,
            },
            {
                id: "92000000-0000-4000-8000-000000000692",
                submissionId: "90000000-0000-4000-8000-000000000692",
                tenantId,
                expenseReportId: reviewReportId,
                sourceType: "line_item",
                sourceId: reviewLineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "712.40",
                currency: "USD",
                flaggedLineItem: true,
            },
        ]);

        const queueResponse = await requestApp("/v1/case-queue/line-items", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const queueBody = (await queueResponse.json()) as Array<{
            id?: string;
            currentStage?: string;
        }>;

        expect(queueResponse.status).toBe(200);
        expect(queueBody).toContainEqual(
            expect.objectContaining({
                id: reviewLineItemId,
                currentStage: "Manager Approval",
            }),
        );
        expect(queueBody).not.toContainEqual(
            expect.objectContaining({
                id: draftedLineItemId,
                currentStage: "Drafted",
            }),
        );
    });

    void test("does not let Employee or platform Admin read or mutate manager queue line items", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000185";
        const owner = "50000000-0000-4000-8000-000000000185";
        const adminId = "51000000-0000-4000-8000-000000000185";
        const reportId = "60000000-0000-4000-8000-000000000185";
        const lineItemId = "30000000-0000-4000-8000-000000000185";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Lodge",
            expenseDate: "2026-07-20",
            amount: "642.30",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000185",
            submissionId: "90000000-0000-4000-8000-000000000185",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            amount: "642.30",
            currency: "USD",
            flaggedLineItem: false,
        });

        const employeeQueueResponse = await requestApp(
            "/v1/case-queue/line-items",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                },
            },
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const adminQueueResponse = await requestApp(
            "/v1/case-queue/line-items",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, adminId, [
                        "Admin",
                    ]),
                },
            },
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const employeeReviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const adminReviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, adminId, [
                        "Admin",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));

        expect(employeeQueueResponse.status).toBe(403);
        expect(adminQueueResponse.status).toBe(403);
        expect(employeeReviewResponse.status).toBe(403);
        expect(adminReviewResponse.status).toBe(403);
        expect(codingRows[0]).toMatchObject({
            lineItemReviewAction: null,
            lineItemReviewedBy: null,
        });
    });

    void test("does not expose or review cross-tenant manager queue line items", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000186";
        const otherTenantId = "40000000-0000-4000-8000-000000000187";
        const owner = "50000000-0000-4000-8000-000000000186";
        const otherOwner = "50000000-0000-4000-8000-000000000187";
        const managerId = "51000000-0000-4000-8000-000000000186";
        const reportId = "60000000-0000-4000-8000-000000000186";
        const otherReportId = "60000000-0000-4000-8000-000000000187";
        const lineItemId = "30000000-0000-4000-8000-000000000186";
        const otherLineItemId = "30000000-0000-4000-8000-000000000187";

        await db.insert(expenseReport).values([
            {
                id: reportId,
                tenantId,
                owner,
                dueDate: "2026-08-17",
                currentStage: "Manager Approval",
            },
            {
                id: otherReportId,
                tenantId: otherTenantId,
                owner: otherOwner,
                dueDate: "2026-08-17",
                currentStage: "Manager Approval",
            },
        ]);
        await db.insert(lineItem).values([
            {
                id: lineItemId,
                tenantId,
                expenseReportId: reportId,
                merchant: "Synthetic Lodge",
                expenseDate: "2026-07-20",
                amount: "642.30",
                currency: "USD",
                category: "Travel",
            },
            {
                id: otherLineItemId,
                tenantId: otherTenantId,
                expenseReportId: otherReportId,
                merchant: "Synthetic Rail",
                expenseDate: "2026-07-21",
                amount: "225.00",
                currency: "USD",
                category: "Travel",
            },
        ]);
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000186",
                submissionId: "90000000-0000-4000-8000-000000000186",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "642.30",
                currency: "USD",
                flaggedLineItem: false,
            },
            {
                id: "91000000-0000-4000-8000-000000000187",
                submissionId: "90000000-0000-4000-8000-000000000187",
                tenantId: otherTenantId,
                expenseReportId: otherReportId,
                sourceType: "line_item",
                sourceId: otherLineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "225.00",
                currency: "USD",
                flaggedLineItem: false,
            },
        ]);

        const queueResponse = await requestApp("/v1/case-queue/line-items", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const queueBody = (await queueResponse.json()) as Array<{
            id?: string;
            expenseReportId?: string;
        }>;
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const reviewResponse = await requestApp(
            `/v1/expense-reports/${otherReportId}/line-items/${otherLineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        const otherCodingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, otherReportId));

        expect(queueResponse.status).toBe(200);
        expect(queueBody).toContainEqual(
            expect.objectContaining({
                id: lineItemId,
                expenseReportId: reportId,
            }),
        );
        expect(queueBody).not.toContainEqual(
            expect.objectContaining({
                id: otherLineItemId,
                expenseReportId: otherReportId,
            }),
        );
        expect(reviewResponse.status).toBe(404);
        expect(otherCodingRows[0]).toMatchObject({
            lineItemReviewAction: null,
            lineItemReviewedBy: null,
        });
    });

    void test("rejects line-item review outside Manager Approval and rejects missing rejection reason", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000188";
        const owner = "50000000-0000-4000-8000-000000000188";
        const managerId = "51000000-0000-4000-8000-000000000188";
        const reportId = "60000000-0000-4000-8000-000000000188";
        const lineItemId = "30000000-0000-4000-8000-000000000188";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Submitted",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Lodge",
            expenseDate: "2026-07-20",
            amount: "642.30",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000188",
            submissionId: "90000000-0000-4000-8000-000000000188",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            amount: "642.30",
            currency: "USD",
            flaggedLineItem: false,
        });

        const invalidStageResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        await db
            .update(expenseReport)
            .set({ currentStage: "Manager Approval" })
            .where(eq(expenseReport.id, reportId));
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const missingReasonResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "reject" }),
            },
        );

        expect(invalidStageResponse.status).toBe(409);
        expect(missingReasonResponse.status).toBe(400);
    });

    void test("uses only the latest submission when reading and reviewing line items", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000189";
        const owner = "50000000-0000-4000-8000-000000000189";
        const managerId = "51000000-0000-4000-8000-000000000189";
        const reportId = "60000000-0000-4000-8000-000000000189";
        const lineItemId = "30000000-0000-4000-8000-000000000189";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-17",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Lodge",
            expenseDate: "2026-07-20",
            amount: "642.30",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000189",
                submissionId: "90000000-0000-4000-8000-000000000189",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "642.30",
                currency: "USD",
                flaggedLineItem: true,
                codedAt: new Date("2026-07-18T10:00:00.000Z"),
            },
            {
                id: "91000000-0000-4000-8000-000000000190",
                submissionId: "90000000-0000-4000-8000-000000000190",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6010",
                glAccountName: "Updated Travel Expense",
                amount: "642.30",
                currency: "USD",
                flaggedLineItem: false,
                codedAt: new Date("2026-07-18T10:05:00.000Z"),
            },
        ]);

        const queueResponse = await requestApp("/v1/case-queue/line-items", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const queueBody = (await queueResponse.json()) as Array<{
            id?: string;
            glCode?: string;
            flaggedLineItem?: boolean;
            canAdvance?: boolean;
        }>;
        await db
            .delete(tenantRateLimitWindow)
            .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        const reviewResponse = await requestApp(
            `/v1/expense-reports/${reportId}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));

        expect(queueResponse.status).toBe(200);
        expect(queueBody).toEqual([
            expect.objectContaining({
                id: lineItemId,
                glCode: "6010",
                flaggedLineItem: false,
                canAdvance: false,
            }),
        ]);
        expect(reviewResponse.status).toBe(200);
        expect(codingRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    submissionId: "90000000-0000-4000-8000-000000000189",
                    lineItemReviewAction: null,
                }),
                expect.objectContaining({
                    submissionId: "90000000-0000-4000-8000-000000000190",
                    lineItemReviewAction: "approve",
                    lineItemReviewedBy: managerId,
                }),
            ]),
        );
    });

    void test("sends AP Review back to Drafted without removing line items or flags", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000153";
        const owner = "50000000-0000-4000-8000-000000000153";
        const financeAdminId = "52000000-0000-4000-8000-000000000153";
        const reportId = "60000000-0000-4000-8000-000000000153";
        const lineItemId = "30000000-0000-4000-8000-000000000153";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-18",
            currentStage: "AP Review",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Hotel",
            expenseDate: "2026-07-20",
            amount: "725.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000153",
            submissionId: "90000000-0000-4000-8000-000000000153",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
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
                    toStage: "Drafted",
                    reason: "employee correction required",
                }),
            },
        );
        const body = (await response.json()) as { currentStage?: string };
        const lineRows = await db
            .select()
            .from(lineItem)
            .where(eq(lineItem.expenseReportId, reportId));
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(200);
        expect(body.currentStage).toBe("Drafted");
        expect(lineRows).toHaveLength(1);
        expect(codingRows[0]).toMatchObject({
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
        });
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "transition_sent_back",
                stageBeforeAction: "AP Review",
                stageAfterProposedAction: "Drafted",
                denialReason: null,
                outcomeReason: "employee correction required",
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "AP Review",
                toStage: "Drafted",
                reason: "employee correction required",
            }),
        );
    });

    void test("updates source deductibility during AP Review and records an audit entry", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000274";
        const owner = "50000000-0000-4000-8000-000000000274";
        const managerId = "52000000-0000-4000-8000-000000000274";
        const reportId = "60000000-0000-4000-8000-000000000274";
        const lineItemId = "30000000-0000-4000-8000-000000000274";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "AP Review",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Hotel",
            expenseDate: "2026-07-20",
            amount: "725.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000274",
            submissionId: "90000000-0000-4000-8000-000000000274",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: false,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/sources/line_item/${lineItemId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: true }),
            },
        );
        const body = (await response.json()) as { deductible?: boolean };
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(response.status).toBe(200);
        expect(body.deductible).toBe(true);
        expect(codingRows[0]?.deductible).toBe(true);
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                actorId: managerId,
                action: "source_deductibility_updated",
                stageBeforeAction: "AP Review",
                stageAfterProposedAction: "AP Review",
                denialReason: null,
                outcomeReason: `manual_deductibility_updated:source_type=line_item;source_id=${lineItemId};deductible=true`,
            }),
        );

        const clearResponse = await requestApp(
            `/v1/expense-reports/${reportId}/sources/line_item/${lineItemId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: false }),
            },
        );
        const clearBody = (await clearResponse.json()) as {
            deductible?: boolean;
        };
        const clearedCodingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const clearedAuditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(clearResponse.status).toBe(200);
        expect(clearBody.deductible).toBe(false);
        expect(clearedCodingRows[0]?.deductible).toBe(false);
        expect(clearedAuditRows).toContainEqual(
            expect.objectContaining({
                actorId: managerId,
                action: "source_deductibility_updated",
                stageBeforeAction: "AP Review",
                stageAfterProposedAction: "AP Review",
                denialReason: null,
                outcomeReason: `manual_deductibility_updated:source_type=line_item;source_id=${lineItemId};deductible=false`,
            }),
        );
    });

    void test("does not persist deductibility when the source row is missing", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000478";
        const owner = "50000000-0000-4000-8000-000000000478";
        const managerId = "52000000-0000-4000-8000-000000000478";
        const reportId = "60000000-0000-4000-8000-000000000478";
        const missingLineItemId = "30000000-0000-4000-8000-000000000478";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "AP Review",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000478",
            submissionId: "90000000-0000-4000-8000-000000000478",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: missingLineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: false,
            deductible: false,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/sources/line_item/${missingLineItemId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: true }),
            },
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(response.status).toBe(404);
        expect(codingRows[0]?.deductible).toBe(false);
        expect(auditRows).toHaveLength(0);
    });

    void test("updates mileage deductibility in a mixed AP Review report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000474";
        const owner = "50000000-0000-4000-8000-000000000474";
        const managerId = "52000000-0000-4000-8000-000000000474";
        const reportId = "60000000-0000-4000-8000-000000000474";
        const lineItemId = "30000000-0000-4000-8000-000000000474";
        const mileageEntryId = "32000000-0000-4000-8000-000000000474";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "AP Review",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Hotel",
            expenseDate: "2026-07-20",
            amount: "725.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Office to synthetic site",
            distance: "18.50",
            mileageDate: "2026-07-21",
        });
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000474",
                submissionId: "90000000-0000-4000-8000-000000000474",
                tenantId,
                expenseReportId: reportId,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                flaggedLineItem: false,
            },
            {
                id: "92000000-0000-4000-8000-000000000474",
                submissionId: "90000000-0000-4000-8000-000000000474",
                tenantId,
                expenseReportId: reportId,
                sourceType: "mileage",
                sourceId: mileageEntryId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6250",
                glAccountName: "Mileage Expense",
                flaggedLineItem: false,
            },
        ]);

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/sources/mileage/${mileageEntryId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: true }),
            },
        );
        const body = (await response.json()) as {
            id?: string;
            mileageEntries?: Array<{ id: string; deductible: boolean }>;
        };
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(response.status).toBe(200);
        expect(body.id).toBe(lineItemId);
        expect(body.mileageEntries).toContainEqual(
            expect.objectContaining({ id: mileageEntryId, deductible: true }),
        );
        expect(
            codingRows.find((row) => row.sourceId === mileageEntryId)
                ?.deductible,
        ).toBe(true);
        expect(
            codingRows.find((row) => row.sourceId === lineItemId)?.deductible,
        ).toBe(false);
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "source_deductibility_updated",
                outcomeReason: `manual_deductibility_updated:source_type=mileage;source_id=${mileageEntryId};deductible=true`,
            }),
        );
    });

    void test("updates mileage deductibility in a mileage-only AP Review report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000475";
        const owner = "50000000-0000-4000-8000-000000000475";
        const managerId = "52000000-0000-4000-8000-000000000475";
        const reportId = "60000000-0000-4000-8000-000000000475";
        const mileageEntryId = "32000000-0000-4000-8000-000000000475";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "AP Review",
        });
        await db.insert(mileageEntry).values({
            id: mileageEntryId,
            tenantId,
            expenseReportId: reportId,
            route: "Office to synthetic site",
            distance: "18.50",
            mileageDate: "2026-07-21",
        });
        await db.insert(glCodingResult).values({
            id: "92000000-0000-4000-8000-000000000475",
            submissionId: "90000000-0000-4000-8000-000000000475",
            tenantId,
            expenseReportId: reportId,
            sourceType: "mileage",
            sourceId: mileageEntryId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6250",
            glAccountName: "Mileage Expense",
            flaggedLineItem: false,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/sources/mileage/${mileageEntryId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: true }),
            },
        );
        const body = (await response.json()) as {
            id?: string;
            sourceType?: string;
            deductible?: boolean;
        };

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            id: mileageEntryId,
            sourceType: "mileage",
            deductible: true,
        });
    });

    void test("does not update source deductibility across tenants", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000476";
        const otherTenantId = "40000000-0000-4000-8000-000000000477";
        const owner = "50000000-0000-4000-8000-000000000476";
        const otherManagerId = "52000000-0000-4000-8000-000000000477";
        const reportId = "60000000-0000-4000-8000-000000000476";
        const lineItemId = "30000000-0000-4000-8000-000000000476";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "AP Review",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Hotel",
            expenseDate: "2026-07-20",
            amount: "725.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000476",
            submissionId: "90000000-0000-4000-8000-000000000476",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: false,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/sources/line_item/${lineItemId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        otherManagerId,
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: true }),
            },
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(response.status).toBe(404);
        expect(codingRows[0]?.deductible).toBe(false);
        expect(auditRows).toHaveLength(0);
    });
    void test("rejects source deductibility updates outside AP Review", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000275";
        const owner = "50000000-0000-4000-8000-000000000275";
        const managerId = "52000000-0000-4000-8000-000000000275";
        const reportId = "60000000-0000-4000-8000-000000000275";
        const lineItemId = "30000000-0000-4000-8000-000000000275";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Hotel",
            expenseDate: "2026-07-20",
            amount: "725.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000275",
            submissionId: "90000000-0000-4000-8000-000000000275",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: false,
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/sources/line_item/${lineItemId}/deductibility`,
            {
                method: "PATCH",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ deductible: true }),
            },
        );
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));

        expect(response.status).toBe(409);
        expect(body).toMatchObject({ title: "Conflict", status: 409 });
        expect(codingRows[0]?.deductible).toBe(false);
    });
    void test("records Employee flag-clear denials as audit-only events", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000183";
        const owner = "50000000-0000-4000-8000-000000000183";
        const reportId = "60000000-0000-4000-8000-000000000183";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-25",
            currentStage: "Manager Approval",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: ["30000000-0000-4000-8000-000000000183"],
                    reason: "employee attempted flag clear",
                }),
            },
        );
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(403);
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                actorId: owner,
                action: "line_item_flags_clear_denied",
                stageBeforeAction: "Manager Approval",
                stageAfterProposedAction: "Manager Approval",
                denialReason: null,
                outcomeReason:
                    "Authenticated role is not permitted to clear line-item flags.",
            }),
        );
        expect(transitionRows).toHaveLength(0);
    });

    void test("refreshes cached rollups through the public workflow and send-back path", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000184";
        const owner = "50000000-0000-4000-8000-000000000184";
        const managerId = "51000000-0000-4000-8000-000000000184";
        const financeAdminId = "52000000-0000-4000-8000-000000000184";
        const lineItemId = "30000000-0000-4000-8000-000000000184";
        const asOfDate = "2026-08-20";
        const resetRateLimit = async () => {
            await db
                .delete(tenantRateLimitWindow)
                .where(eq(tenantRateLimitWindow.tenantId, tenantId));
        };
        const readRollups = async () => {
            const response = await requestApp(
                `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
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

            expect(response.status).toBe(200);
            return (await response.json()) as Array<{
                currentStage: string;
                reportCount: number;
                overdueCount: number;
            }>;
        };
        const expectRollup = (
            rollups: Array<{
                currentStage: string;
                reportCount: number;
                overdueCount: number;
            }>,
            currentStage: string,
            reportCount: number,
            overdueCount: number,
        ) => {
            expect(
                rollups.find((rollup) => rollup.currentStage === currentStage),
            ).toMatchObject({ reportCount, overdueCount });
        };

        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-create-184",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-10" }),
        });
        const created = (await createResponse.json()) as { id?: string };

        expect(createResponse.status).toBe(201);
        if (created.id === undefined) {
            throw new Error("Expected created Expense Report id");
        }

        await db.insert(lineItem).values({
            id: lineItemId,
            tenantId,
            expenseReportId: created.id,
            merchant: "Synthetic Rail",
            expenseDate: "2026-07-20",
            amount: "125.00",
            currency: "USD",
            category: "Travel",
        });
        await resetRateLimit();
        const warmedRollups = await readRollups();
        expectRollup(warmedRollups, "Drafted", 1, 1);
        expectRollup(warmedRollups, "Submitted", 0, 0);

        glCodingClientMock.mockResolvedValueOnce({
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
                    amount: "125.00",
                    currency: "USD",
                    flagged_line_item: false,
                },
            ],
            flags: [],
        });
        await resetRateLimit();
        const submitResponse = await requestApp(
            `/v1/expense-reports/${created.id}/submit`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                    "idempotency-key": "expense-submit-184",
                },
                body: JSON.stringify({
                    employerEin: "123456789",
                    employerLegalName: "Synthetic Employer LLC",
                }),
            },
        );

        expect(submitResponse.status).toBe(201);
        await resetRateLimit();
        const submittedRollups = await readRollups();
        expectRollup(submittedRollups, "Drafted", 0, 0);
        expectRollup(submittedRollups, "Submitted", 1, 1);

        await resetRateLimit();
        const managerApprovalResponse = await requestApp(
            `/v1/expense-reports/${created.id}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "Manager Approval",
                    reason: "manager review started",
                }),
            },
        );
        await resetRateLimit();
        const reviewResponse = await requestApp(
            `/v1/expense-reports/${created.id}/line-items/${lineItemId}/review`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "approve" }),
            },
        );
        await resetRateLimit();
        const apReviewResponse = await requestApp(
            `/v1/expense-reports/${created.id}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "AP Review",
                    reason: "manager approved",
                }),
            },
        );
        await resetRateLimit();
        const sendBackResponse = await requestApp(
            `/v1/expense-reports/${created.id}/transitions`,
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
                    toStage: "Drafted",
                    reason: "employee correction required",
                }),
            },
        );

        expect(managerApprovalResponse.status).toBe(200);
        expect(reviewResponse.status).toBe(200);
        expect(apReviewResponse.status).toBe(200);
        expect(sendBackResponse.status).toBe(200);
        await resetRateLimit();
        const sentBackRollups = await readRollups();
        expectRollup(sentBackRollups, "Drafted", 1, 1);
        expectRollup(sentBackRollups, "Submitted", 0, 0);
        expectRollup(sentBackRollups, "Manager Approval", 0, 0);
        expectRollup(sentBackRollups, "AP Review", 0, 0);
        expect(redisClientMock.incr).toHaveBeenCalledWith(
            `case-queue-rollup-version:${tenantId}`,
        );

        const reportRows = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, created.id));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, created.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, created.id));

        expect(reportRows[0]?.currentStage).toBe("Drafted");
        expect(auditRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: "transition_approved",
                    stageBeforeAction: "Drafted",
                    stageAfterProposedAction: "Submitted",
                }),
                expect.objectContaining({
                    action: "transition_approved",
                    stageBeforeAction: "Submitted",
                    stageAfterProposedAction: "Manager Approval",
                }),
                expect.objectContaining({
                    action: "transition_approved",
                    stageBeforeAction: "Manager Approval",
                    stageAfterProposedAction: "AP Review",
                }),
                expect.objectContaining({
                    action: "transition_sent_back",
                    stageBeforeAction: "AP Review",
                    stageAfterProposedAction: "Drafted",
                    outcomeReason: "employee correction required",
                }),
            ]),
        );
        expect(transitionRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    fromStage: "Drafted",
                    toStage: "Submitted",
                }),
                expect.objectContaining({
                    fromStage: "Submitted",
                    toStage: "Manager Approval",
                }),
                expect.objectContaining({
                    fromStage: "Manager Approval",
                    toStage: "AP Review",
                }),
                expect.objectContaining({
                    fromStage: "AP Review",
                    toStage: "Drafted",
                }),
            ]),
        );
    });
    void test("does not clear flags outside Manager Approval", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000158";
        const owner = "50000000-0000-4000-8000-000000000158";
        const managerId = "51000000-0000-4000-8000-000000000158";
        const reportId = "60000000-0000-4000-8000-000000000158";
        const lineItemId = "30000000-0000-4000-8000-000000000158";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-21",
            currentStage: "Submitted",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000158",
            submissionId: "90000000-0000-4000-8000-000000000158",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [lineItemId],
                    reason: "premature flag clear attempt",
                }),
            },
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));

        expect(response.status).toBe(409);
        expect(codingRows[0]).toMatchObject({
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
        });
    });
    void test("does not transition an Expense Report from another tenant", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000374";
        const otherTenantId = "40000000-0000-4000-8000-000000000375";
        const owner = "50000000-0000-4000-8000-000000000374";
        const managerId = "51000000-0000-4000-8000-000000000374";
        const reportId = "60000000-0000-4000-8000-000000000374";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-19",
            currentStage: "Submitted",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        managerId,
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    toStage: "Manager Approval",
                    reason: "cross tenant attempt",
                }),
            },
        );
        const reportRows = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(404);
        expect(stageTransitionPublishMock).not.toHaveBeenCalled();
        expect(reportRows[0]).toMatchObject({
            tenantId,
            currentStage: "Submitted",
        });
        expect(auditRows).toHaveLength(0);
        expect(transitionRows).toHaveLength(0);
    });

    void test("does not clear flags on an Expense Report from another tenant", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000156";
        const otherTenantId = "40000000-0000-4000-8000-000000000157";
        const owner = "50000000-0000-4000-8000-000000000156";
        const managerId = "51000000-0000-4000-8000-000000000156";
        const reportId = "60000000-0000-4000-8000-000000000156";
        const lineItemId = "30000000-0000-4000-8000-000000000156";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-20",
            currentStage: "Manager Approval",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000156",
            submissionId: "90000000-0000-4000-8000-000000000156",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });

        const response = await requestApp(
            `/v1/expense-reports/${reportId}/flags/clear`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        managerId,
                        ["Department Manager"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    sourceIds: [lineItemId],
                    reason: "cross tenant flag clear attempt",
                }),
            },
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, reportId));

        expect(response.status).toBe(404);
        expect(codingRows[0]).toMatchObject({
            tenantId,
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
        });
        expect(auditRows).toHaveLength(0);
        expect(transitionRows).toHaveLength(0);
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

    void test("shows a submitted case change in the audit table and Audit Trail API", async () => {
        const tenantId = randomUUID();
        const owner = randomUUID();
        const financeAdminId = randomUUID();
        const reportId = randomUUID();
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-14",
            currentStage: "Submitted",
        });
        await db.insert(lineItem).values({
            id: randomUUID(),
            tenantId,
            expenseReportId: reportId,
            merchant: "Synthetic Audit Trail Rail",
            expenseDate: "2026-08-01",
            category: "Travel",
            amount: "42.25",
            currency: "USD",
        });

        const transitionResponse = await requestApp(
            `/v1/expense-reports/${reportId}/transitions`,
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
                    toStage: "Manager Approval",
                    reason: "Synthetic audit trail transition.",
                }),
            },
        );

        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, reportId),
                ),
            );
        const auditResponse = await requestApp(
            `/v1/expense-reports/${reportId}/audit-entries`,
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
            action?: string;
            stageBeforeAction?: string;
            stageAfterProposedAction?: string;
        }>;

        expect(transitionResponse.status).toBe(200);
        expect(auditRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: "transition_approved",
                    stageBeforeAction: "Submitted",
                    stageAfterProposedAction: "Manager Approval",
                }),
            ]),
        );
        expect(auditResponse.status).toBe(200);
        expect(auditBody).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: "transition_approved",
                    stageBeforeAction: "Submitted",
                    stageAfterProposedAction: "Manager Approval",
                }),
            ]),
        );
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

    void test("lets a Finance Admin create and read comments for an Expense Report", async () => {
        const tenantId = randomUUID();
        const owner = randomUUID();
        const financeAdminId = randomUUID();
        const reportId = randomUUID();
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-11",
            currentStage: "Submitted",
        });

        const commentResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
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
                    body: "  Synthetic finance dispute comment.  ",
                }),
            },
        );
        const commentBody = (await commentResponse.json()) as {
            tenantId?: string;
            expenseReportId?: string;
            authorId?: string;
            body?: string;
        };

        const listResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
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
        const comments = (await listResponse.json()) as Array<{
            body?: string;
        }>;

        expect(commentResponse.status).toBe(201);
        expect(commentBody).toMatchObject({
            tenantId,
            expenseReportId: reportId,
            authorId: financeAdminId,
            body: "Synthetic finance dispute comment.",
        });
        expect(listResponse.status).toBe(200);
        expect(comments).toEqual([
            expect.objectContaining({
                body: "Synthetic finance dispute comment.",
            }),
        ]);
    });

    void test("does not read or create comments for another tenant's Expense Report", async () => {
        const tenantId = randomUUID();
        const otherTenantId = randomUUID();
        const owner = randomUUID();
        const financeAdminId = randomUUID();
        const otherTenantFinanceAdminId = randomUUID();
        const reportId = randomUUID();
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-11",
            currentStage: "Submitted",
        });
        await db.insert(caseComment).values({
            id: randomUUID(),
            tenantId,
            expenseReportId: reportId,
            authorId: financeAdminId,
            body: "Synthetic tenant-scoped finance comment.",
        });

        const crossTenantReadResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
            {
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        otherTenantFinanceAdminId,
                        ["Finance Admin"],
                    ),
                },
            },
        );
        const crossTenantCreateResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(
                        otherTenantId,
                        otherTenantFinanceAdminId,
                        ["Finance Admin"],
                    ),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    body: "Synthetic cross-tenant comment attempt.",
                }),
            },
        );
        const persistedComments = await db
            .select({ id: caseComment.id, tenantId: caseComment.tenantId })
            .from(caseComment)
            .where(eq(caseComment.expenseReportId, reportId));

        expect(crossTenantReadResponse.status).toBe(404);
        expect(crossTenantCreateResponse.status).toBe(404);
        expect(persistedComments).toEqual([
            expect.objectContaining({ tenantId }),
        ]);
    });

    void test("lets Employees comment only on their own Expense Reports", async () => {
        const tenantId = randomUUID();
        const owner = randomUUID();
        const otherEmployee = randomUUID();
        const reportId = randomUUID();
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-12",
            currentStage: "Submitted",
        });

        const ownCommentResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, owner),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    body: "Synthetic employee dispute comment.",
                }),
            },
        );
        const otherEmployeeResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
            {
                headers: {
                    authorization: authorizationHeader(tenantId, otherEmployee),
                },
            },
        );

        expect(ownCommentResponse.status).toBe(201);
        expect(otherEmployeeResponse.status).toBe(404);
    });

    void test("rejects Employee comment creation on another owner's Expense Report", async () => {
        const tenantId = randomUUID();
        const owner = randomUUID();
        const otherEmployee = randomUUID();
        const reportId = randomUUID();
        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner,
            dueDate: "2026-08-12",
            currentStage: "Submitted",
        });

        const otherEmployeeCreateResponse = await requestApp(
            `/v1/expense-reports/${reportId}/comments`,
            {
                method: "POST",
                headers: {
                    authorization: authorizationHeader(tenantId, otherEmployee),
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    body: "Synthetic cross-owner comment attempt.",
                }),
            },
        );

        expect(otherEmployeeCreateResponse.status).toBe(404);
    });

    void test("rejects blank comment requests before writing a comment", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000126";
        const owner = "50000000-0000-4000-8000-000000000029";
        const financeAdminId = "50000000-0000-4000-8000-000000000030";
        const createResponse = await requestApp("/v1/expense-reports", {
            method: "POST",
            headers: {
                authorization: authorizationHeader(tenantId, owner),
                "content-type": "application/json",
                "idempotency-key": "expense-submit-126",
            },
            body: JSON.stringify({ owner, dueDate: "2026-08-13" }),
        });
        const created = (await createResponse.json()) as { id: string };

        const commentResponse = await requestApp(
            `/v1/expense-reports/${created.id}/comments`,
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
                body: JSON.stringify({ body: "   " }),
            },
        );
        const body = (await commentResponse.json()) as {
            title?: string;
            status?: number;
        };

        expect(commentResponse.status).toBe(400);
        expect(body).toMatchObject({ title: "Bad Request", status: 400 });
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

    void test("returns Finance Dashboard trends for the authenticated tenant", async () => {
        const tenantA = "40000000-0000-4000-8000-000000000220";
        const tenantB = "40000000-0000-4000-8000-000000000221";
        const owner = "50000000-0000-4000-8000-000000000220";
        await db
            .insert(expenseReport)
            .values([
                buildDashboardTrendReport(
                    "30000000-0000-4000-8000-000000000220",
                    tenantA,
                    owner,
                    "2026-07-01T00:00:00.000Z",
                ),
                buildDashboardTrendReport(
                    "30000000-0000-4000-8000-000000000221",
                    tenantA,
                    owner,
                    "2026-07-02T11:15:00.000Z",
                ),
                buildDashboardTrendReport(
                    "30000000-0000-4000-8000-000000000222",
                    tenantA,
                    owner,
                    "2026-07-03T23:59:59.000Z",
                ),
                buildDashboardTrendReport(
                    "30000000-0000-4000-8000-000000000223",
                    tenantB,
                    owner,
                    "2026-07-02T12:00:00.000Z",
                ),
            ]);
        await db
            .insert(lineItem)
            .values([
                buildDashboardTrendLineItem(
                    "31000000-0000-4000-8000-000000000220",
                    tenantA,
                    "30000000-0000-4000-8000-000000000220",
                    "100.00",
                    "USD",
                ),
                buildDashboardTrendLineItem(
                    "31000000-0000-4000-8000-000000000221",
                    tenantA,
                    "30000000-0000-4000-8000-000000000220",
                    "40.00",
                    "USD",
                ),
                buildDashboardTrendLineItem(
                    "31000000-0000-4000-8000-000000000222",
                    tenantA,
                    "30000000-0000-4000-8000-000000000221",
                    "65.00",
                    "EUR",
                ),
                buildDashboardTrendLineItem(
                    "31000000-0000-4000-8000-000000000223",
                    tenantB,
                    "30000000-0000-4000-8000-000000000223",
                    "999.00",
                    "USD",
                ),
            ]);

        const response = await requestApp(
            "/v1/finance-dashboard/trends?fromDate=2026-07-01&toDate=2026-07-04",
            {
                headers: {
                    authorization: authorizationHeader(tenantA, owner, [
                        "Finance Admin",
                    ]),
                },
            },
        );
        const body = (await response.json()) as unknown;

        expect(response.status).toBe(200);
        expect(body).toEqual([
            {
                periodStart: "2026-07-01",
                reportCount: 1,
                spendByCurrency: [{ currency: "USD", spendAmount: "140.00" }],
            },
            {
                periodStart: "2026-07-02",
                reportCount: 1,
                spendByCurrency: [{ currency: "EUR", spendAmount: "65.00" }],
            },
            {
                periodStart: "2026-07-03",
                reportCount: 1,
                spendByCurrency: [],
            },
            {
                periodStart: "2026-07-04",
                reportCount: 0,
                spendByCurrency: [],
            },
        ]);
    });

    void test("returns 401 for Finance Dashboard trends without a token", async () => {
        const response = await requestApp(
            "/v1/finance-dashboard/trends?fromDate=2026-07-01&toDate=2026-07-04",
        );
        const body = (await response.json()) as {
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(401);
        expect(body).toMatchObject({
            status: 401,
            title: "Unauthorized",
        });
    });

    void test("returns 403 for Finance Dashboard trends with an external role", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000224";
        const employeeId = "50000000-0000-4000-8000-000000000224";
        const response = await requestApp(
            "/v1/finance-dashboard/trends?fromDate=2026-07-01&toDate=2026-07-04",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, employeeId, [
                        "Employee",
                    ]),
                },
            },
        );
        const body = (await response.json()) as {
            detail?: string;
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(403);
        expect(body).toMatchObject({
            detail: "Finance Dashboard access is limited to Finance Admins.",
            status: 403,
            title: "Forbidden",
        });
    });

    void test("returns 403 for Finance Dashboard trends with a Department Manager role", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000226";
        const managerId = "50000000-0000-4000-8000-000000000226";
        const response = await requestApp(
            "/v1/finance-dashboard/trends?fromDate=2026-07-01&toDate=2026-07-04",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, managerId, [
                        "Department Manager",
                    ]),
                },
            },
        );
        const body = (await response.json()) as {
            detail?: string;
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(403);
        expect(body).toMatchObject({
            detail: "Finance Dashboard access is limited to Finance Admins.",
            status: 403,
            title: "Forbidden",
        });
    });
    void test("returns 400 for Finance Dashboard trends with an invalid date range", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000225";
        const financeAdminId = "50000000-0000-4000-8000-000000000225";
        const response = await requestApp(
            "/v1/finance-dashboard/trends?fromDate=2026-07-04&toDate=2026-07-01",
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
        const body = (await response.json()) as {
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
            status: 400,
            title: "Bad Request",
        });
    });

    void test("returns 400 for Finance Dashboard trends with an over-limit date range", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000227";
        const financeAdminId = "50000000-0000-4000-8000-000000000227";
        const response = await requestApp(
            "/v1/finance-dashboard/trends?fromDate=2026-07-01&toDate=2026-08-01",
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
        const body = (await response.json()) as {
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
            status: 400,
            title: "Bad Request",
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

    void test("returns 403 for Case Queue rollups with an external role", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000109";
        const employeeId = "50000000-0000-4000-8000-000000000109";
        const response = await requestApp(
            "/v1/case-queue/rollups?asOfDate=2026-07-20",
            {
                headers: {
                    authorization: authorizationHeader(tenantId, employeeId, [
                        "Employee",
                    ]),
                },
            },
        );
        const body = (await response.json()) as {
            detail?: string;
            status?: number;
            title?: string;
        };

        expect(response.status).toBe(403);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Forbidden",
            status: 403,
            detail: "Case Queue access is limited to internal roles.",
        });
    });

    void test("lists tenant-scoped All Transactions for Finance Admins", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000160";
        const otherTenantId = "40000000-0000-4000-8000-000000000161";
        const owner = "50000000-0000-4000-8000-000000000160";
        const financeAdminId = "51000000-0000-4000-8000-000000000160";

        await db.insert(expenseReport).values([
            {
                id: "60000000-0000-4000-8000-000000000160",
                tenantId,
                owner,
                dueDate: "2026-07-20",
                currentStage: "AP Review",
            },
            {
                id: "60000000-0000-4000-8000-000000000161",
                tenantId: otherTenantId,
                owner,
                dueDate: "2026-07-20",
                currentStage: "AP Review",
            },
        ]);
        await db.insert(lineItem).values([
            {
                id: "30000000-0000-4000-8000-000000000160",
                tenantId,
                expenseReportId: "60000000-0000-4000-8000-000000000160",
                merchant: "Cedar Bistro",
                amount: "64.20",
                currency: "USD",
                category: "Meals",
                expenseDate: "2026-07-20",
                createdAt: new Date("2026-08-20T12:00:00.000Z"),
            },
            {
                id: "30000000-0000-4000-8000-000000000161",
                tenantId: otherTenantId,
                expenseReportId: "60000000-0000-4000-8000-000000000161",
                merchant: "Cedar Bistro",
                amount: "64.20",
                currency: "USD",
                category: "Meals",
                expenseDate: "2026-07-20",
                createdAt: new Date("2026-08-20T12:00:00.000Z"),
            },
        ]);

        const response = await requestApp(
            "/v1/transactions?category=Meals&status=AP%20Review&startDate=2026-07-20&endDate=2026-07-20",
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
        const body = (await response.json()) as {
            items?: Array<{
                id?: string;
                expenseReportId?: string;
                date?: string;
                merchant?: string;
                category?: string;
                amount?: string;
                currency?: string;
                status?: string;
                deductible?: boolean | null;
                owner?: string;
                priority?: string;
                dueDate?: string;
                onHold?: boolean;
                isOverdue?: boolean;
                glCode?: string | null;
                flaggedLineItem?: boolean;
                reviewAction?: string | null;
            }>;
            nextCursor?: string | null;
        };

        expect(response.status).toBe(200);
        expect(response.headers.get("ratelimit-limit")).toBe("2");
        expect(body.items).toHaveLength(1);
        expect(body.items?.[0]).toEqual({
            id: "30000000-0000-4000-8000-000000000160",
            expenseReportId: "60000000-0000-4000-8000-000000000160",
            date: "2026-07-20T00:00:00.000Z",
            merchant: "Cedar Bistro",
            category: "Meals",
            amount: "64.20",
            currency: "USD",
            status: "AP Review",
            deductible: null,
            owner,
            priority: "Normal",
            dueDate: "2026-07-20",
            onHold: false,
            isOverdue: true,
            glCode: null,
            flaggedLineItem: false,
            reviewAction: null,
        });
        expect(
            body.items?.some(
                (transaction) =>
                    transaction.id === "30000000-0000-4000-8000-000000000161",
            ),
        ).toBe(false);
        expect(body.nextCursor).toBeNull();
    });

    void test("rejects malformed All Transactions filters", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000162";
        const financeAdminId = "51000000-0000-4000-8000-000000000162";

        const response = await requestApp(
            "/v1/transactions?status=Archived&startDate=2026-07-21&endDate=2026-07-20",
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
        const body = (await response.json()) as { status?: number };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({ status: 400 });
    });

    void test("rejects invalid All Transactions cursors", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000164";
        const financeAdminId = "51000000-0000-4000-8000-000000000164";

        const response = await requestApp(
            "/v1/transactions?cursor=not-a-cursor",
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
        const body = (await response.json()) as { status?: number };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({ status: 400 });
    });

    void test("rejects All Transactions limits above the server maximum", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000165";
        const financeAdminId = "51000000-0000-4000-8000-000000000165";

        const response = await requestApp("/v1/transactions?limit=101", {
            headers: {
                authorization: authorizationHeader(tenantId, financeAdminId, [
                    "Finance Admin",
                ]),
            },
        });
        const body = (await response.json()) as { status?: number };

        expect(response.status).toBe(400);
        expect(body).toMatchObject({ status: 400 });
    });

    void test("returns 403 for All Transactions with non-Finance Admin roles", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000163";
        const managerId = "51000000-0000-4000-8000-000000000163";

        const response = await requestApp("/v1/transactions", {
            headers: {
                authorization: authorizationHeader(tenantId, managerId, [
                    "Department Manager",
                ]),
            },
        });
        const body = (await response.json()) as { status?: number };

        expect(response.status).toBe(403);
        expect(body).toMatchObject({ status: 403 });
    });

    void test("returns 401 for All Transactions without a token", async () => {
        const response = await requestApp("/v1/transactions");
        const body = (await response.json()) as {
            status?: number;
            title?: string;
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
