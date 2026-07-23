import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { IdempotencyResult } from "../../idempotency/idempotencyStore.js";

const logExpenseReportAuditErrorMock = vi.hoisted(() => vi.fn());
const logExpenseReportAuditSuccessMock = vi.hoisted(() => vi.fn());
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
    saveResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../logging/coreCaseLogger.js", () => ({
    logExpenseReportAuditError: logExpenseReportAuditErrorMock,
    logExpenseReportAuditSuccess: logExpenseReportAuditSuccessMock,
}));

vi.mock("../../idempotency/defaultIdempotencyStore.js", () => ({
    getDefaultIdempotencyStore: () => idempotencyStoreMock,
}));

import { UnauthorizedError } from "../../errors/problem-json.js";

const readCachedCaseQueueStageRollupsMock = vi.hoisted(() => vi.fn());

vi.mock("../services/caseQueueService.js", () => ({
    readCachedCaseQueueStageRollups: readCachedCaseQueueStageRollupsMock,
}));

import {
    getCaseQueueStageRollups,
    getExpenseReportById,
    postExpenseReport,
    getExpenseReportAuditEntries,
} from "./expenseReportController.js";

void describe("Expense Report controller authorization", () => {
    beforeEach(() => {
        readCachedCaseQueueStageRollupsMock.mockReset();
        idempotencyRecords.clear();
        idempotencyStoreMock.acquireLock.mockClear();
        idempotencyStoreMock.getResult.mockClear();
        idempotencyStoreMock.releaseLock.mockClear();
        idempotencyStoreMock.saveResult.mockClear();
        logExpenseReportAuditErrorMock.mockClear();
        logExpenseReportAuditSuccessMock.mockClear();
    });

    void test("rejects direct handler invocation without auth context", async () => {
        const request = {
            params: { id: "30000000-0000-4000-8000-000000000001" },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getExpenseReportById(request, {} as Response, next);

        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    void test("uses authenticated tenant for Case Queue rollups instead of query tenant", async () => {
        readCachedCaseQueueStageRollupsMock.mockResolvedValue([]);

        const authenticatedTenantId = "40000000-0000-4000-8000-000000000001";
        const requestedTenantId = "50000000-0000-4000-8000-000000000001";
        const request = {
            auth: {
                tenantId: authenticatedTenantId,
                userId: "60000000-0000-4000-8000-000000000001",
                roles: ["Finance Admin"],
            },
            query: {
                tenantId: requestedTenantId,
                asOfDate: "2026-07-20",
            },
        } as unknown as Request;
        const status = vi.fn().mockReturnThis();
        const response = {
            status,
            json: vi.fn(),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        await getCaseQueueStageRollups(request, response, next);

        expect(readCachedCaseQueueStageRollupsMock).toHaveBeenCalledWith({
            tenantId: authenticatedTenantId,
            asOfDate: "2026-07-20",
        });
        expect(readCachedCaseQueueStageRollupsMock).not.toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: requestedTenantId }),
        );
        expect(status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });

    void test("logs create errors with a static route name instead of the raw URL", async () => {
        const rawPaymentReference = "synthetic-payment-reference";
        const request = {
            auth: {
                tenantId: "40000000-0000-4000-8000-000000000701",
                userId: "50000000-0000-4000-8000-000000000701",
                roles: ["Finance Admin"],
            },
            body: {
                dueDate: "2026-08-01",
            },
            get: vi.fn(),
            originalUrl: `/v1/expense-reports?paymentId=${rawPaymentReference}`,
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await postExpenseReport(request, {} as Response, next);

        expect(logExpenseReportAuditErrorMock).toHaveBeenCalledOnce();
        const payload = logExpenseReportAuditErrorMock.mock.calls[0]?.[0] as
            Record<string, unknown> | undefined;

        expect(payload).toMatchObject({
            route: "POST /v1/expense-reports",
        });
        expect(JSON.stringify(payload)).not.toContain(rawPaymentReference);
    });

    void test("omits unvalidated route ids from audit-read error logs", async () => {
        const rawPaymentReference = "synthetic-payment-reference";
        const request = {
            auth: {
                tenantId: "40000000-0000-4000-8000-000000000702",
                userId: "50000000-0000-4000-8000-000000000702",
                roles: ["Finance Admin"],
            },
            originalUrl: `/v1/expense-reports/${rawPaymentReference}/audit-entries?paymentId=${rawPaymentReference}`,
            params: { id: rawPaymentReference },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getExpenseReportAuditEntries(request, {} as Response, next);

        expect(logExpenseReportAuditErrorMock).toHaveBeenCalledOnce();
        const payload = logExpenseReportAuditErrorMock.mock.calls[0]?.[0] as
            Record<string, unknown> | undefined;

        expect(payload).toMatchObject({
            expenseReportId: undefined,
            route: "GET /v1/expense-reports/:id/audit-entries",
        });
        expect(JSON.stringify(payload)).not.toContain(rawPaymentReference);
    });

    void test("does not log a creation audit event for cached idempotency replays", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000703";
        const owner = "50000000-0000-4000-8000-000000000703";
        const idempotencyKey = "cached-submit-key";
        const cachedBody = {
            id: "60000000-0000-4000-8000-000000000703",
            tenantId,
        };
        idempotencyRecords.set(`${tenantId}:${idempotencyKey}`, {
            body: cachedBody,
            statusCode: 201,
        });
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        const response = {
            status,
        } as unknown as Response;
        const request = {
            auth: {
                tenantId,
                userId: owner,
                roles: ["Employee"],
            },
            body: {
                dueDate: "2026-08-01",
                owner,
            },
            get: vi.fn((headerName: string) =>
                headerName.toLowerCase() === "idempotency-key"
                    ? idempotencyKey
                    : undefined,
            ),
            originalUrl: "/v1/expense-reports",
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await postExpenseReport(request, response, next);

        expect(next).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith(cachedBody);
        expect(logExpenseReportAuditSuccessMock).not.toHaveBeenCalled();
        expect(idempotencyStoreMock.acquireLock).not.toHaveBeenCalled();
    });
});
