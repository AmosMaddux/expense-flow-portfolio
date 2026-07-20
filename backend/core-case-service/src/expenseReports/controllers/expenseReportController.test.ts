import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, test, vi } from "vitest";

const logExpenseReportAuditErrorMock = vi.hoisted(() => vi.fn());
const logExpenseReportAuditSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("../../logging/coreCaseLogger.js", () => ({
    coreCaseLogger: {},
    logExpenseReportAuditError: logExpenseReportAuditErrorMock,
    logExpenseReportAuditSuccess: logExpenseReportAuditSuccessMock,
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
        const payload = logExpenseReportAuditErrorMock.mock.calls[0]?.[1] as
            | Record<string, unknown>
            | undefined;

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
        const payload = logExpenseReportAuditErrorMock.mock.calls[0]?.[1] as
            | Record<string, unknown>
            | undefined;

        expect(payload).toMatchObject({
            expenseReportId: undefined,
            route: "GET /v1/expense-reports/:id/audit-entries",
        });
        expect(JSON.stringify(payload)).not.toContain(rawPaymentReference);
    });
});
