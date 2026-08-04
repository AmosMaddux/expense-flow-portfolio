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

import {
    ForbiddenError,
    UnauthorizedError,
} from "../../errors/problem-json.js";

const readCachedCaseQueueStageRollupsMock = vi.hoisted(() => vi.fn());
const readMySubmissionDetailMock = vi.hoisted(() => vi.fn());
const readMySubmissionsMock = vi.hoisted(() => vi.fn());
const transitionExpenseReportWorkflowMock = vi.hoisted(() => vi.fn());

vi.mock("../services/caseQueueService.js", () => ({
    readCachedCaseQueueStageRollups: readCachedCaseQueueStageRollupsMock,
}));

vi.mock("../services/mySubmissionsService.js", () => ({
    readMySubmissionDetail: readMySubmissionDetailMock,
    readMySubmissions: readMySubmissionsMock,
}));

vi.mock("../services/expenseReportService.js", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("../services/expenseReportService.js")
    >()),
    transitionExpenseReportWorkflow: transitionExpenseReportWorkflowMock,
}));

import {
    getCaseQueueStageRollups,
    getExpenseReportById,
    getMySubmissionDetail,
    getMySubmissions,
    postExpenseReport,
    getExpenseReportAuditEntries,
    postExpenseReportTransition,
} from "./expenseReportController.js";

void describe("Expense Report controller authorization", () => {
    beforeEach(() => {
        readCachedCaseQueueStageRollupsMock.mockReset();
        readMySubmissionDetailMock.mockReset();
        readMySubmissionsMock.mockReset();
        transitionExpenseReportWorkflowMock.mockReset();
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

    void test("rejects external roles before reading Case Queue rollups", async () => {
        const request = {
            auth: {
                tenantId: "40000000-0000-4000-8000-000000000011",
                userId: "50000000-0000-4000-8000-000000000011",
                roles: ["Employee"],
            },
            query: {
                asOfDate: "2026-07-20",
            },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getCaseQueueStageRollups(request, {} as Response, next);

        expect(readCachedCaseQueueStageRollupsMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    void test("scopes My Submissions from auth context instead of request input", async () => {
        readMySubmissionsMock.mockResolvedValue([]);
        const authenticatedTenantId = "40000000-0000-4000-8000-000000000021";
        const authenticatedUserId = "50000000-0000-4000-8000-000000000021";
        const request = {
            auth: {
                tenantId: authenticatedTenantId,
                userId: authenticatedUserId,
                roles: ["Employee"],
            },
            query: {
                tenantId: "60000000-0000-4000-8000-000000000021",
                ownerId: "70000000-0000-4000-8000-000000000021",
            },
        } as unknown as Request;
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        const next = vi.fn() as NextFunction;

        await getMySubmissions(
            request,
            { status } as unknown as Response,
            next,
        );

        expect(readMySubmissionsMock).toHaveBeenCalledExactlyOnceWith({
            tenantId: authenticatedTenantId,
            ownerId: authenticatedUserId,
            pageSize: 25,
        });
        expect(status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });

    void test("rejects internal roles before reading My Submissions", async () => {
        const request = {
            auth: {
                tenantId: "40000000-0000-4000-8000-000000000022",
                userId: "50000000-0000-4000-8000-000000000022",
                roles: ["Finance Admin"],
            },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getMySubmissions(request, {} as Response, next);

        expect(readMySubmissionsMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    void test("scopes submission details to the authenticated employee", async () => {
        const reportId = "30000000-0000-4000-8000-000000000023";
        const authenticatedTenantId = "40000000-0000-4000-8000-000000000023";
        const authenticatedUserId = "50000000-0000-4000-8000-000000000023";
        readMySubmissionDetailMock.mockResolvedValue({
            id: reportId,
            currentStage: "Submitted",
            rejectionReason: null,
            lineItems: [],
            mileageEntries: [],
        });
        const request = {
            auth: {
                tenantId: authenticatedTenantId,
                userId: authenticatedUserId,
                roles: ["Employee"],
            },
            params: { id: reportId },
        } as unknown as Request;
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        const next = vi.fn() as NextFunction;

        await getMySubmissionDetail(
            request,
            { status } as unknown as Response,
            next,
        );

        expect(readMySubmissionDetailMock).toHaveBeenCalledExactlyOnceWith({
            id: reportId,
            tenantId: authenticatedTenantId,
            ownerId: authenticatedUserId,
        });
        expect(status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });

    void test("rejects non-employee roles before reading submission details", async () => {
        const request = {
            auth: {
                tenantId: "40000000-0000-4000-8000-000000000024",
                userId: "50000000-0000-4000-8000-000000000024",
                roles: ["Department Manager"],
            },
            params: {
                id: "30000000-0000-4000-8000-000000000024",
            },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getMySubmissionDetail(request, {} as Response, next);

        expect(readMySubmissionDetailMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
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

    void test("logs successful workflow transitions without raw request data", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000704";
        const actorId = "50000000-0000-4000-8000-000000000704";
        const expenseReportId = "60000000-0000-4000-8000-000000000704";
        const correlationId = "70000000-0000-4000-8000-000000000704";
        transitionExpenseReportWorkflowMock.mockResolvedValue({
            id: expenseReportId,
            tenantId,
            owner: actorId,
            dueDate: "2026-08-01",
            priority: "Normal",
            currentStage: "Manager Approval",
            onHold: false,
            holdReason: null,
            createdAt: new Date("2026-08-01T12:00:00.000Z"),
            updatedAt: new Date("2026-08-01T12:00:00.000Z"),
        });
        const set = vi.fn();
        const json = vi.fn();
        const status = vi.fn(() => ({ json }));
        const response = { set, status } as unknown as Response;
        const request = {
            auth: {
                tenantId,
                userId: actorId,
                roles: ["Department Manager"],
            },
            body: {
                toStage: "Manager Approval",
                reason: "manager review started",
            },
            get: vi.fn((headerName: string) =>
                headerName.toLowerCase() === "x-correlation-id"
                    ? correlationId
                    : undefined,
            ),
            originalUrl:
                "/v1/expense-reports/60000000-0000-4000-8000-000000000704/transitions?paymentReference=synthetic-payment-reference",
            params: { id: expenseReportId },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await postExpenseReportTransition(request, response, next);

        expect(transitionExpenseReportWorkflowMock).toHaveBeenCalledWith(
            expect.objectContaining({
                actorId,
                correlationId,
                id: expenseReportId,
                reason: "manager review started",
                tenantId,
                toStage: "Manager Approval",
            }),
        );
        expect(logExpenseReportAuditSuccessMock).toHaveBeenCalledOnce();
        const payload = logExpenseReportAuditSuccessMock.mock.calls[0]?.[0] as
            Record<string, unknown> | undefined;
        expect(payload).toMatchObject({
            action: "workflow_transition_applied",
            actorId,
            currentStage: "Manager Approval",
            expenseReportId,
            route: "POST /v1/expense-reports/:id/transitions",
            tenantId,
            toStage: "Manager Approval",
        });
        expect(JSON.stringify(payload)).not.toContain(
            "synthetic-payment-reference",
        );
        expect(set).toHaveBeenCalledWith("X-Correlation-Id", correlationId);
        expect(status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });
});
