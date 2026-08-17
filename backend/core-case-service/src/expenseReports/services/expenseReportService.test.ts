import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from "../../errors/problem-json.js";

const buildSubmissionSourceFingerprintMock = vi.hoisted(() => vi.fn());
const buildSubmissionSourceKeysMock = vi.hoisted(() => vi.fn());
const codeExpenseLineItemsMock = vi.hoisted(() => vi.fn());
const findAuditEntriesByExpenseReportIdMock = vi.hoisted(() => vi.fn());
const findCaseCommentsByExpenseReportIdMock = vi.hoisted(() => vi.fn());
const findCurrentDraftExpenseReportMock = vi.hoisted(() => vi.fn());
const findExpenseReportByIdMock = vi.hoisted(() => vi.fn());
const findExpenseReportReviewDetailMock = vi.hoisted(() => vi.fn());
const findReceiptFileMetadataMock = vi.hoisted(() => vi.fn());
const findExpenseReportSummariesMock = vi.hoisted(() => vi.fn());
const insertCaseCommentForExpenseReportMock = vi.hoisted(() => vi.fn());
const insertMileageEntryMock = vi.hoisted(() => vi.fn());
const abandonUnpaidExpenseReportSettlementClaimMock = vi.hoisted(() => vi.fn());
const claimExpenseReportSettlementMock = vi.hoisted(() => vi.fn());
const markExpenseReportSettlementCompensatedMock = vi.hoisted(() => vi.fn());
const reconcileExpenseReportSettlementStageMock = vi.hoisted(() => vi.fn());
const recordExpenseReportSettlementPaymentMock = vi.hoisted(() => vi.fn());
const transitionIssuedExpenseReportSettlementToPaidMock = vi.hoisted(() =>
    vi.fn(),
);
const readDraftSubmissionSourcesMock = vi.hoisted(() => vi.fn());
const receiptStorageMock = vi.hoisted(() => ({
    get: vi.fn(),
    put: vi.fn(),
    verify: vi.fn(),
}));
const submitDraftExpenseReportMock = vi.hoisted(() => vi.fn());
const transitionExpenseReportStageMock = vi.hoisted(() => vi.fn());
const compensatePaidSettlementStageMock = vi.hoisted(() => vi.fn());
const insertDeniedWorkflowTransitionAttemptMock = vi.hoisted(() => vi.fn());
const invalidateCachedCaseQueueStageRollupsMock = vi.hoisted(() => vi.fn());
const updateExpenseReportSourceDeductibilityMock = vi.hoisted(() => vi.fn());

vi.mock("../repository/expenseReportRepository.js", () => ({
    abandonUnpaidExpenseReportSettlementClaim:
        abandonUnpaidExpenseReportSettlementClaimMock,
    buildSubmissionSourceFingerprint: buildSubmissionSourceFingerprintMock,
    buildSubmissionSourceKeys: buildSubmissionSourceKeysMock,
    clearExpenseReportFlags: vi.fn(),
    claimExpenseReportSettlement: claimExpenseReportSettlementMock,
    compensatePaidSettlementStage: compensatePaidSettlementStageMock,
    countOpenExpenseReportFlags: vi.fn(),
    findApprovalQueueLineItems: vi.fn(),
    findAuditEntriesByExpenseReportId: findAuditEntriesByExpenseReportIdMock,
    findCaseCommentsByExpenseReportId: findCaseCommentsByExpenseReportIdMock,
    findCurrentDraftExpenseReport: findCurrentDraftExpenseReportMock,
    findExpenseReportById: findExpenseReportByIdMock,
    findExpenseReportReviewDetail: findExpenseReportReviewDetailMock,
    findReceiptFileMetadata: findReceiptFileMetadataMock,
    findExpenseReportSummaries: findExpenseReportSummariesMock,
    insertDeniedSubmissionAuditEntry: vi.fn(),
    insertDeniedWorkflowTransitionAttempt:
        insertDeniedWorkflowTransitionAttemptMock,
    insertCaseCommentForExpenseReport: insertCaseCommentForExpenseReportMock,
    insertDraftExpenseReport: vi.fn(),
    insertMileageEntry: insertMileageEntryMock,
    markExpenseReportSettlementCompensated:
        markExpenseReportSettlementCompensatedMock,
    reconcileExpenseReportSettlementStage:
        reconcileExpenseReportSettlementStageMock,
    readDraftSubmissionSources: readDraftSubmissionSourcesMock,
    recordExpenseReportSettlementPayment:
        recordExpenseReportSettlementPaymentMock,
    reviewExpenseReportLineItem: vi.fn(),
    submitDraftExpenseReport: submitDraftExpenseReportMock,
    transitionIssuedExpenseReportSettlementToPaid:
        transitionIssuedExpenseReportSettlementToPaidMock,
    transitionExpenseReportStage: transitionExpenseReportStageMock,
    updateExpenseReportSourceDeductibility:
        updateExpenseReportSourceDeductibilityMock,
}));

vi.mock("../../receipts/receiptStorage.js", () => ({
    getDefaultReceiptStorage: () => receiptStorageMock,
}));

vi.mock("../../auth/shared/accessTokenSigner.js", () => ({
    signAccessToken: vi.fn(() => ({ accessToken: "synthetic-access-token" })),
}));

vi.mock("../../config/authJwtConfig.js", () => ({
    loadAuthJwtConfig: vi.fn(() => ({
        AUTH_JWT_ALGORITHM: "RS256",
        AUTH_JWT_AUDIENCE: "expenseflow-api",
        AUTH_JWT_EXPIRES_IN_SECONDS: 300,
        AUTH_JWT_ISSUER: "expenseflow-test",
        AUTH_JWT_PRIVATE_KEY: "synthetic-private-key",
        AUTH_JWT_PUBLIC_KEY: "synthetic-public-key",
    })),
}));

vi.mock("../../config/glCodingConfig.js", () => ({
    loadDefaultGlCodingConfig: vi.fn(() => ({
        GL_CODING_SERVICE_BASE_URL: "https://gl-coding.example.test",
        GL_CODING_TIMEOUT_MS: 100,
        GL_CODING_MAX_RETRIES: 0,
        GL_CODING_BASE_BACKOFF_MS: 1,
        GL_CODING_MAX_BACKOFF_MS: 1,
    })),
}));

vi.mock("../../glCoding/glCodingClient.js", () => ({
    codeExpenseLineItems: codeExpenseLineItemsMock,
}));

vi.mock("./caseQueueService.js", () => ({
    invalidateCachedCaseQueueStageRollups:
        invalidateCachedCaseQueueStageRollupsMock,
}));

import {
    addMileageEntry,
    createExpenseReportComment,
    updateExpenseReportSourceDeductibility,
    readCurrentDraftExpenseReport,
    readExpenseReportAuditEntries,
    readExpenseReportComments,
    readExpenseReportReviewDetail,
    readReceiptFile,
    readExpenseReportSummaries,
    settleExpenseReportWorkflow,
    submitExpenseReport,
    transitionExpenseReportWorkflow,
} from "./expenseReportService.js";

const originalMileageRate = process.env.MILEAGE_REIMBURSEMENT_RATE;

beforeEach(() => {
    process.env.MILEAGE_REIMBURSEMENT_RATE = "0.70";
    findAuditEntriesByExpenseReportIdMock.mockReset();
    findCaseCommentsByExpenseReportIdMock.mockReset();
    buildSubmissionSourceFingerprintMock.mockReset();
    buildSubmissionSourceKeysMock.mockReset();
    codeExpenseLineItemsMock.mockReset();
    findCurrentDraftExpenseReportMock.mockReset();
    findExpenseReportByIdMock.mockReset();
    findExpenseReportReviewDetailMock.mockReset();
    findReceiptFileMetadataMock.mockReset();
    receiptStorageMock.get.mockReset();
    receiptStorageMock.put.mockReset();
    receiptStorageMock.verify.mockReset();
    findExpenseReportSummariesMock.mockReset();
    insertCaseCommentForExpenseReportMock.mockReset();
    insertMileageEntryMock.mockReset();
    abandonUnpaidExpenseReportSettlementClaimMock.mockReset();
    claimExpenseReportSettlementMock.mockReset();
    markExpenseReportSettlementCompensatedMock.mockReset();
    reconcileExpenseReportSettlementStageMock.mockReset();
    recordExpenseReportSettlementPaymentMock.mockReset();
    transitionIssuedExpenseReportSettlementToPaidMock.mockReset();
    readDraftSubmissionSourcesMock.mockReset();
    submitDraftExpenseReportMock.mockReset();
    transitionExpenseReportStageMock.mockReset();
    compensatePaidSettlementStageMock.mockReset();
    insertDeniedWorkflowTransitionAttemptMock.mockReset();
    invalidateCachedCaseQueueStageRollupsMock.mockReset();
    updateExpenseReportSourceDeductibilityMock.mockReset();
});

void describe("Expense Report summaries", () => {
    void test("returns display category and underlying category membership", async () => {
        findExpenseReportSummariesMock.mockResolvedValue({
            items: [
                {
                    id: "30000000-0000-4000-8000-000000000901",
                    createdAt: new Date("2026-07-22T12:00:00.000Z"),
                    employeeId: "50000000-0000-4000-8000-000000000901",
                    managerId: null,
                    category: "Multiple",
                    categories: ["Meals", "Travel"],
                    amount: "150.50",
                    currency: "USD",
                    status: "Manager Approval",
                },
            ],
            nextCursor: null,
        });

        const summaries = await readExpenseReportSummaries({
            tenantId: "40000000-0000-4000-8000-000000000901",
            roles: ["Finance Admin"],
        });

        expect(summaries.items[0]).toMatchObject({
            category: "Multiple",
            categories: ["Meals", "Travel"],
        });
        expect(findExpenseReportSummariesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                limit: 50,
                tenantId: "40000000-0000-4000-8000-000000000901",
            }),
        );
    });

    void test("rejects summaries without category membership", async () => {
        findExpenseReportSummariesMock.mockResolvedValue({
            items: [
                {
                    id: "30000000-0000-4000-8000-000000000902",
                    createdAt: new Date("2026-07-22T12:00:00.000Z"),
                    employeeId: "50000000-0000-4000-8000-000000000902",
                    managerId: null,
                    category: "Travel",
                    amount: "150.50",
                    currency: "USD",
                    status: "Manager Approval",
                },
            ],
            nextCursor: null,
        });

        await expect(
            readExpenseReportSummaries({
                tenantId: "40000000-0000-4000-8000-000000000902",
                roles: ["Finance Admin"],
            }),
        ).rejects.toThrow(ZodError);
    });

    void test.each([["Department Manager" as const], ["Employee" as const]])(
        "rejects Expense Report summaries for %s",
        async (role) => {
            await expect(
                readExpenseReportSummaries({
                    tenantId: "40000000-0000-4000-8000-000000000903",
                    roles: [role],
                }),
            ).rejects.toThrow(ForbiddenError);
            expect(findExpenseReportSummariesMock).not.toHaveBeenCalled();
        },
    );
});

void describe("Expense Report stage-transition outbox dispatch", () => {
    const tenantId = "40000000-0000-4000-8000-000000000801";
    const actorId = "50000000-0000-4000-8000-000000000801";
    const expenseReportId = "60000000-0000-4000-8000-000000000801";
    const correlationId = "70000000-0000-4000-8000-000000000801";
    const submittedReport = {
        id: expenseReportId,
        tenantId,
        owner: actorId,
        dueDate: "2026-07-31",
        priority: "Normal",
        currentStage: "Submitted",
        onHold: false,
        holdReason: null,
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        updatedAt: new Date("2026-07-20T12:00:00.000Z"),
    };

    void test("dispatches exactly once after a successful transition", async () => {
        const dispatch = vi.fn().mockResolvedValue(undefined);
        findExpenseReportByIdMock
            .mockResolvedValueOnce(submittedReport)
            .mockResolvedValueOnce({
                ...submittedReport,
                currentStage: "Manager Approval",
            });
        transitionExpenseReportStageMock.mockResolvedValue(true);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        await transitionExpenseReportWorkflow(
            {
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Department Manager"],
                toStage: "Manager Approval",
                reason: "Synthetic manager review started.",
                correlationId,
            },
            { stageTransitionOutboxDispatcher: { dispatch } },
        );

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(expect.any(String));
        const dispatchedEventId: unknown = dispatch.mock.calls[0]?.[0];
        const transitionRequest: unknown =
            transitionExpenseReportStageMock.mock.calls[0]?.[0];
        expect(transitionRequest).toMatchObject({
            correlationId,
            eventId: dispatchedEventId,
        });
        expect(
            (transitionRequest as { occurredAt?: unknown }).occurredAt,
        ).toBeInstanceOf(Date);
    });

    void test("does not dispatch when the transition is denied", async () => {
        const dispatch = vi.fn().mockResolvedValue(undefined);
        findExpenseReportByIdMock.mockResolvedValue(submittedReport);
        transitionExpenseReportStageMock.mockResolvedValue(false);

        await expect(
            transitionExpenseReportWorkflow(
                {
                    id: expenseReportId,
                    tenantId,
                    actorId,
                    roles: ["Department Manager"],
                    toStage: "Manager Approval",
                    reason: "Synthetic manager review started.",
                    correlationId,
                },
                { stageTransitionOutboxDispatcher: { dispatch } },
            ),
        ).rejects.toThrow(
            "Expense Report cannot transition from Submitted to Manager Approval.",
        );

        expect(dispatch).not.toHaveBeenCalled();
    });

    void test("does not dispatch when the transactional stage change rolls back", async () => {
        const dispatch = vi.fn().mockResolvedValue(undefined);
        findExpenseReportByIdMock.mockResolvedValue(submittedReport);
        transitionExpenseReportStageMock.mockRejectedValue(
            new Error("synthetic transaction rollback"),
        );

        await expect(
            transitionExpenseReportWorkflow(
                {
                    id: expenseReportId,
                    tenantId,
                    actorId,
                    roles: ["Department Manager"],
                    toStage: "Manager Approval",
                    reason: "Synthetic manager review started.",
                    correlationId,
                },
                { stageTransitionOutboxDispatcher: { dispatch } },
            ),
        ).rejects.toThrow("synthetic transaction rollback");

        expect(
            invalidateCachedCaseQueueStageRollupsMock,
        ).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    void test("invalidates the cache and returns the committed transition when immediate dispatch fails", async () => {
        const dispatch = vi
            .fn()
            .mockRejectedValue(new Error("synthetic outbox dispatch failure"));
        findExpenseReportByIdMock
            .mockResolvedValueOnce(submittedReport)
            .mockResolvedValueOnce({
                ...submittedReport,
                currentStage: "Manager Approval",
            });
        transitionExpenseReportStageMock.mockResolvedValue(true);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        const result = await transitionExpenseReportWorkflow(
            {
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Department Manager"],
                toStage: "Manager Approval",
                reason: "Synthetic manager review started.",
                correlationId,
            },
            { stageTransitionOutboxDispatcher: { dispatch } },
        );

        expect(result.currentStage).toBe("Manager Approval");
        expect(
            invalidateCachedCaseQueueStageRollupsMock,
        ).toHaveBeenCalledExactlyOnceWith(tenantId);
        expect(dispatch).toHaveBeenCalledOnce();
        expect(
            invalidateCachedCaseQueueStageRollupsMock.mock
                .invocationCallOrder[0],
        ).toBeLessThan(dispatch.mock.invocationCallOrder[0] ?? 0);
    });

    void test("rejects settlement-owned edges from the generic workflow", async () => {
        findExpenseReportByIdMock.mockResolvedValue({
            ...submittedReport,
            currentStage: "AP Review",
        });

        await expect(
            transitionExpenseReportWorkflow({
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Finance Admin"],
                toStage: "Paid",
                reason: "Synthetic generic payment attempt.",
                correlationId,
            }),
        ).rejects.toThrow(
            "Expense Report settlement transitions must use the settlement route.",
        );

        expect(insertDeniedWorkflowTransitionAttemptMock).toHaveBeenCalledWith({
            tenantId,
            id: expenseReportId,
            actor: actorId,
            toStage: "Paid",
            denialReason:
                "Settlement-owned transition must use the settlement route.",
        });
        expect(transitionExpenseReportStageMock).not.toHaveBeenCalled();
    });
});

void describe("Expense Report settlement saga", () => {
    const tenantId = "40000000-0000-4000-8000-000000000811";
    const actorId = "50000000-0000-4000-8000-000000000811";
    const expenseReportId = "60000000-0000-4000-8000-000000000811";
    const settlementId = "61000000-0000-4000-8000-000000000811";
    const correlationId = "70000000-0000-4000-8000-000000000811";
    const apReviewReport = {
        id: expenseReportId,
        tenantId,
        owner: actorId,
        dueDate: "2026-07-31",
        priority: "Normal",
        currentStage: "AP Review",
        onHold: false,
        holdReason: null,
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        updatedAt: new Date("2026-07-20T12:00:00.000Z"),
    };

    void test("issues a synthetic payment stub before moving to Paid and Reconciled", async () => {
        const dispatch = vi.fn().mockResolvedValue(undefined);
        const issue = vi
            .fn()
            .mockResolvedValue({ paymentId: "synthetic-payment-success" });
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        findExpenseReportByIdMock.mockResolvedValueOnce({
            ...apReviewReport,
            currentStage: "Reconciled",
        });
        recordExpenseReportSettlementPaymentMock.mockResolvedValue({
            kind: "recorded",
            settlement: {
                paymentId: "synthetic-payment-success",
            },
        });
        transitionIssuedExpenseReportSettlementToPaidMock.mockResolvedValue(
            true,
        );
        reconcileExpenseReportSettlementStageMock.mockResolvedValue(true);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        const report = await settleExpenseReportWorkflow(
            {
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Finance Admin"],
                reason: "Synthetic settlement complete.",
                correlationId,
                idempotencyKey: "settlement-success",
            },
            {
                paymentStubIssuer: { issue, compensate },
                stageTransitionOutboxDispatcher: { dispatch },
            },
        );

        expect(report.currentStage).toBe("Reconciled");
        expect(issue).toHaveBeenCalledWith({
            tenantId,
            expenseReportId,
            actorId,
            correlationId,
        });
        expect(compensate).not.toHaveBeenCalled();
        expect(transitionExpenseReportStageMock).not.toHaveBeenCalled();
        expect(
            transitionIssuedExpenseReportSettlementToPaidMock,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                actor: actorId,
                correlationId,
                id: expenseReportId,
                idempotencyKey: "settlement-success",
                paymentId: "synthetic-payment-success",
                reason: "payment_stub_issued",
                settlementId,
                tenantId,
            }),
        );
        expect(reconcileExpenseReportSettlementStageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                actor: actorId,
                correlationId,
                id: expenseReportId,
                idempotencyKey: "settlement-success",
                paymentId: "synthetic-payment-success",
                reason: "Synthetic settlement complete.",
                tenantId,
            }),
        );
        expect(dispatch).toHaveBeenCalledTimes(2);
    });

    void test("does not compensate when final reconciliation succeeds but cache invalidation fails", async () => {
        const dispatch = vi.fn().mockResolvedValue(undefined);
        const issue = vi.fn().mockResolvedValue({
            paymentId: "synthetic-payment-cache-failure",
        });
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        findExpenseReportByIdMock.mockResolvedValueOnce({
            ...apReviewReport,
            currentStage: "Reconciled",
        });
        recordExpenseReportSettlementPaymentMock.mockResolvedValue({
            kind: "recorded",
            settlement: {
                paymentId: "synthetic-payment-cache-failure",
            },
        });
        transitionIssuedExpenseReportSettlementToPaidMock.mockResolvedValue(
            true,
        );
        reconcileExpenseReportSettlementStageMock.mockResolvedValue(true);
        invalidateCachedCaseQueueStageRollupsMock
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("synthetic cache failure"));

        const report = await settleExpenseReportWorkflow(
            {
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Finance Admin"],
                reason: "Synthetic settlement complete.",
                correlationId,
                idempotencyKey: "settlement-cache-failure",
            },
            {
                paymentStubIssuer: { issue, compensate },
                stageTransitionOutboxDispatcher: { dispatch },
            },
        );

        expect(report.currentStage).toBe("Reconciled");
        expect(compensate).not.toHaveBeenCalled();
        expect(compensatePaidSettlementStageMock).not.toHaveBeenCalled();
        expect(
            markExpenseReportSettlementCompensatedMock,
        ).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledTimes(2);
    });

    void test("compensates the payment stub and Paid stage when reconciliation fails", async () => {
        const dispatch = vi.fn().mockResolvedValue(undefined);
        const issue = vi
            .fn()
            .mockResolvedValue({ paymentId: "synthetic-payment-rollback" });
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        recordExpenseReportSettlementPaymentMock.mockResolvedValue({
            kind: "recorded",
            settlement: {
                paymentId: "synthetic-payment-rollback",
            },
        });
        transitionIssuedExpenseReportSettlementToPaidMock.mockResolvedValueOnce(
            true,
        );
        reconcileExpenseReportSettlementStageMock.mockResolvedValue(false);
        compensatePaidSettlementStageMock.mockResolvedValue({
            kind: "compensated",
            eventId: "80000000-0000-4000-8000-000000000811",
        });
        markExpenseReportSettlementCompensatedMock.mockResolvedValue(true);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        await expect(
            settleExpenseReportWorkflow(
                {
                    id: expenseReportId,
                    tenantId,
                    actorId,
                    roles: ["Finance Admin"],
                    correlationId,
                    idempotencyKey: "settlement-rollback",
                },
                {
                    paymentStubIssuer: { issue, compensate },
                    stageTransitionOutboxDispatcher: { dispatch },
                },
            ),
        ).rejects.toThrow(
            "Expense Report cannot transition from Paid to Reconciled.",
        );

        expect(compensate).toHaveBeenCalledWith({
            tenantId,
            expenseReportId,
            actorId,
            correlationId,
            paymentId: "synthetic-payment-rollback",
            reason: "Settlement saga failed before reconciliation completed.",
        });
        expect(compensatePaidSettlementStageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId,
                id: expenseReportId,
                actor: actorId,
                correlationId,
                reason: "Settlement saga failed before reconciliation completed.",
                eventId: expect.any(String) as string,
                occurredAt: expect.any(Date) as Date,
            }),
        );
        expect(markExpenseReportSettlementCompensatedMock).toHaveBeenCalledWith(
            {
                tenantId,
                id: expenseReportId,
                settlementId,
                paymentId: "synthetic-payment-rollback",
            },
        );
    });

    void test("abandons the unpaid settlement claim when payment issuance fails", async () => {
        const issue = vi
            .fn()
            .mockRejectedValue(new Error("synthetic issue failure"));
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        abandonUnpaidExpenseReportSettlementClaimMock.mockResolvedValue({
            kind: "abandoned",
        });

        await expect(
            settleExpenseReportWorkflow(
                {
                    id: expenseReportId,
                    tenantId,
                    actorId,
                    roles: ["Finance Admin"],
                    correlationId,
                    idempotencyKey: "settlement-issue-failure",
                },
                {
                    paymentStubIssuer: { issue, compensate },
                },
            ),
        ).rejects.toThrow("synthetic issue failure");

        expect(
            abandonUnpaidExpenseReportSettlementClaimMock,
        ).toHaveBeenCalledWith({
            tenantId,
            id: expenseReportId,
            settlementId,
        });
        expect(compensate).not.toHaveBeenCalled();
    });

    void test("reports cleanup failure when an unpaid settlement claim cannot be abandoned", async () => {
        const issue = vi
            .fn()
            .mockRejectedValue(new Error("synthetic issue failure"));
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        abandonUnpaidExpenseReportSettlementClaimMock.mockResolvedValue({
            kind: "not_abandoned",
        });

        await expect(
            settleExpenseReportWorkflow(
                {
                    id: expenseReportId,
                    tenantId,
                    actorId,
                    roles: ["Finance Admin"],
                    correlationId,
                    idempotencyKey: "settlement-abandon-failure",
                },
                {
                    paymentStubIssuer: { issue, compensate },
                },
            ),
        ).rejects.toThrow(
            "Expense Report settlement payment failed and the unpaid claim could not be released.",
        );
    });

    void test("fails compensation when the settlement cannot be marked compensated", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const issue = vi.fn().mockResolvedValue({
            paymentId: "synthetic-payment-unmarked-compensation",
        });
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        recordExpenseReportSettlementPaymentMock.mockResolvedValue({
            kind: "recorded",
            settlement: {
                paymentId: "synthetic-payment-unmarked-compensation",
            },
        });
        transitionIssuedExpenseReportSettlementToPaidMock.mockResolvedValueOnce(
            true,
        );
        reconcileExpenseReportSettlementStageMock.mockResolvedValue(false);
        compensatePaidSettlementStageMock.mockResolvedValue({
            kind: "compensated",
            eventId: "80000000-0000-4000-8000-000000000812",
        });
        markExpenseReportSettlementCompensatedMock.mockResolvedValue(false);

        try {
            await expect(
                settleExpenseReportWorkflow(
                    {
                        id: expenseReportId,
                        tenantId,
                        actorId,
                        roles: ["Finance Admin"],
                        correlationId,
                        idempotencyKey: "settlement-unmarked-compensation",
                    },
                    {
                        paymentStubIssuer: { issue, compensate },
                    },
                ),
            ).rejects.toThrow(
                "Settlement saga failed and compensation could not complete.",
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    void test("redacts private identifiers from settlement compensation error logs", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const issue = vi.fn().mockResolvedValue({
            paymentId: "synthetic-payment-log-redaction",
        });
        const compensate = vi
            .fn()
            .mockRejectedValue(new Error("synthetic compensation failure"));
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "issue_payment",
            settlement: {
                id: settlementId,
                paymentId: null,
            },
        });
        recordExpenseReportSettlementPaymentMock.mockResolvedValue({
            kind: "recorded",
            settlement: {
                paymentId: "synthetic-payment-log-redaction",
            },
        });
        transitionIssuedExpenseReportSettlementToPaidMock.mockResolvedValueOnce(
            true,
        );
        reconcileExpenseReportSettlementStageMock.mockResolvedValue(false);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        try {
            await expect(
                settleExpenseReportWorkflow(
                    {
                        id: expenseReportId,
                        tenantId,
                        actorId,
                        roles: ["Finance Admin"],
                        correlationId,
                        idempotencyKey: "settlement-log-redaction",
                    },
                    {
                        paymentStubIssuer: { issue, compensate },
                    },
                ),
            ).rejects.toThrow(
                "Settlement saga failed and compensation could not complete.",
            );

            const emittedLogs = JSON.stringify(consoleError.mock.calls);
            expect(emittedLogs).not.toContain(expenseReportId);
            expect(emittedLogs).not.toContain(tenantId);
        } finally {
            consoleError.mockRestore();
        }
    });

    void test("rejects compensated settlement records without reusing payment", async () => {
        const issue = vi.fn().mockResolvedValue({
            paymentId: "synthetic-payment-should-not-issue",
        });
        const compensate = vi.fn().mockResolvedValue(undefined);
        claimExpenseReportSettlementMock.mockResolvedValue({
            kind: "terminal_compensated",
            settlement: {
                paymentId: "synthetic-payment-compensated",
                status: "compensated",
            },
        });

        await expect(
            settleExpenseReportWorkflow(
                {
                    id: expenseReportId,
                    tenantId,
                    actorId,
                    roles: ["Finance Admin"],
                    correlationId,
                    idempotencyKey: "settlement-compensated",
                },
                {
                    paymentStubIssuer: { issue, compensate },
                },
            ),
        ).rejects.toThrow(
            "Expense Report settlement was compensated and cannot be reused.",
        );

        expect(issue).not.toHaveBeenCalled();
        expect(compensate).not.toHaveBeenCalled();
    });
});

void describe("Expense Report submission EIN validation", () => {
    void test("submits through the existing Employee flow when employer fields are omitted", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000812";
        const actorId = "50000000-0000-4000-8000-000000000812";
        const expenseReportId = "60000000-0000-4000-8000-000000000812";
        const correlationId = "70000000-0000-4000-8000-000000000812";
        const sourceId = "80000000-0000-4000-8000-000000000812";
        const expectedSourceKeys = new Set([`line_item:${sourceId}`]);
        const expectedFingerprint = "synthetic-submission-fingerprint";
        const submittedReport = {
            id: expenseReportId,
            tenantId,
            owner: actorId,
            dueDate: "2026-07-31",
            priority: "Normal",
            currentStage: "Submitted",
            onHold: false,
            holdReason: null,
            employerEin: null,
            employerLegalName: null,
            employerEinValidationStatus: null,
            employerEinValidationReason: null,
            employerEinServiceReferenceId: null,
            employerEinValidatedAt: null,
            createdAt: new Date("2026-07-20T12:00:00.000Z"),
            updatedAt: new Date("2026-07-30T12:00:00.000Z"),
        };
        const einValidationAcl = {
            validateEin: vi.fn(),
        };
        const dispatch = vi.fn().mockResolvedValue(undefined);

        readDraftSubmissionSourcesMock.mockResolvedValue({
            report: { id: expenseReportId },
            lineItems: [
                {
                    id: sourceId,
                    merchant: "Synthetic Air",
                    amount: "42.00",
                    currency: "USD",
                    category: "Travel",
                },
            ],
            mileageEntries: [],
            receipts: [],
        });
        buildSubmissionSourceKeysMock.mockReturnValue(expectedSourceKeys);
        buildSubmissionSourceFingerprintMock.mockReturnValue(
            expectedFingerprint,
        );
        codeExpenseLineItemsMock.mockResolvedValue({
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
        submitDraftExpenseReportMock.mockResolvedValue(submittedReport);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        const result = await submitExpenseReport(
            {
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Employee"],
                correlationId,
                idempotencyKey: "synthetic-submit-no-ein-validation",
                requestHash: "synthetic-submit-no-ein-validation-hash",
            },
            {
                einValidationAcl,
                stageTransitionOutboxDispatcher: { dispatch },
            },
        );

        expect(einValidationAcl.validateEin).not.toHaveBeenCalled();
        expect(submitDraftExpenseReportMock).toHaveBeenCalledTimes(1);
        expect(submitDraftExpenseReportMock.mock.calls[0]?.[7]).toBeNull();
        expect(result.report.employerEin).toBeNull();
        expect(result.report.employerLegalName).toBeNull();
        expect(result.report.employerEinValidation).toBeNull();
    });

    void test("validates employer EIN during submission and persists a non-blocking invalid result", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000811";
        const actorId = "50000000-0000-4000-8000-000000000811";
        const expenseReportId = "60000000-0000-4000-8000-000000000811";
        const correlationId = "70000000-0000-4000-8000-000000000811";
        const sourceId = "80000000-0000-4000-8000-000000000811";
        const expectedSourceKeys = new Set([`line_item:${sourceId}`]);
        const expectedFingerprint = "synthetic-submission-fingerprint";
        const invalidEinResult = {
            status: "invalid" as const,
            isValid: false as const,
            rejectionReason: "Synthetic EIN and legal name mismatch.",
            serviceReferenceId: "synthetic-reference-811",
        };
        const submittedReport = {
            id: expenseReportId,
            tenantId,
            owner: actorId,
            dueDate: "2026-07-31",
            priority: "Normal",
            currentStage: "Submitted",
            onHold: false,
            holdReason: null,
            employerEin: "123456789",
            employerLegalName: "Synthetic Employer LLC",
            employerEinValidationStatus: "invalid",
            employerEinValidationReason:
                "Synthetic EIN and legal name mismatch.",
            employerEinServiceReferenceId: "synthetic-reference-811",
            employerEinValidatedAt: new Date("2026-07-30T12:00:00.000Z"),
            createdAt: new Date("2026-07-20T12:00:00.000Z"),
            updatedAt: new Date("2026-07-30T12:00:00.000Z"),
        };
        const einValidationAcl = {
            validateEin: vi.fn().mockResolvedValue(invalidEinResult),
        };
        const dispatch = vi.fn().mockResolvedValue(undefined);

        readDraftSubmissionSourcesMock.mockResolvedValue({
            report: { id: expenseReportId },
            lineItems: [
                {
                    id: sourceId,
                    merchant: "Synthetic Air",
                    amount: "42.00",
                    currency: "USD",
                    category: "Travel",
                },
            ],
            mileageEntries: [],
            receipts: [],
        });
        buildSubmissionSourceKeysMock.mockReturnValue(expectedSourceKeys);
        buildSubmissionSourceFingerprintMock.mockReturnValue(
            expectedFingerprint,
        );
        codeExpenseLineItemsMock.mockResolvedValue({
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
        submitDraftExpenseReportMock.mockResolvedValue(submittedReport);
        invalidateCachedCaseQueueStageRollupsMock.mockResolvedValue(undefined);

        const result = await submitExpenseReport(
            {
                id: expenseReportId,
                tenantId,
                actorId,
                roles: ["Employee"],
                correlationId,
                idempotencyKey: "synthetic-submit-ein-validation",
                requestHash: "synthetic-submit-ein-validation-hash",
                employerEin: "123456789",
                employerLegalName: "Synthetic Employer LLC",
            },
            {
                einValidationAcl,
                stageTransitionOutboxDispatcher: { dispatch },
            },
        );

        expect(einValidationAcl.validateEin).toHaveBeenCalledExactlyOnceWith({
            ein: "123456789",
            legalName: "Synthetic Employer LLC",
        });
        expect(submitDraftExpenseReportMock).toHaveBeenCalledTimes(1);
        const submitDraftCall = submitDraftExpenseReportMock.mock.calls[0] as [
            string,
            string,
            string,
            string,
            { coded_items: unknown[] },
            Set<string>,
            string,
            {
                ein: string;
                legalName: string;
                result: typeof invalidEinResult;
                validatedAt: Date;
            },
            {
                correlationId: string;
                idempotencyKey: string;
            },
        ];
        expect(submitDraftCall[0]).toBe(tenantId);
        expect(submitDraftCall[1]).toBe(expenseReportId);
        expect(submitDraftCall[2]).toBe(actorId);
        expect(typeof submitDraftCall[3]).toBe("string");
        expect(submitDraftCall[4].coded_items).toHaveLength(1);
        expect(submitDraftCall[5]).toBe(expectedSourceKeys);
        expect(submitDraftCall[6]).toBe(expectedFingerprint);
        expect(submitDraftCall[7]).toMatchObject({
            ein: "123456789",
            legalName: "Synthetic Employer LLC",
            result: invalidEinResult,
        });
        expect(submitDraftCall[7].validatedAt).toBeInstanceOf(Date);
        expect(submitDraftCall[8]).toMatchObject({
            correlationId,
            idempotencyKey: "synthetic-submit-ein-validation",
        });
        expect(result.report.employerEinValidation).toStrictEqual({
            status: "invalid",
            isValid: false,
            reason: "Synthetic EIN and legal name mismatch.",
            serviceReferenceId: "synthetic-reference-811",
            validatedAt: new Date("2026-07-30T12:00:00.000Z"),
        });
    });
});

afterAll(() => {
    if (originalMileageRate === undefined) {
        delete process.env.MILEAGE_REIMBURSEMENT_RATE;
        return;
    }

    process.env.MILEAGE_REIMBURSEMENT_RATE = originalMileageRate;
});

void describe("Expense Report mileage service", () => {
    const tenantId = "40000000-0000-4000-8000-000000000901";
    const ownerId = "50000000-0000-4000-8000-000000000901";
    const expenseReportId = "60000000-0000-4000-8000-000000000901";

    void test("reads the employee's current Drafted Expense Report", async () => {
        findCurrentDraftExpenseReportMock.mockResolvedValue({
            id: expenseReportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-07-31",
            priority: "Normal",
            currentStage: "Drafted",
            onHold: false,
            holdReason: null,
            createdAt: new Date("2026-07-20T12:00:00.000Z"),
            updatedAt: new Date("2026-07-20T12:00:00.000Z"),
        });

        const report = await readCurrentDraftExpenseReport({
            tenantId,
            ownerId,
        });

        expect(report.id).toBe(expenseReportId);
        expect(findCurrentDraftExpenseReportMock).toHaveBeenCalledWith(
            tenantId,
            ownerId,
        );
    });

    void test("reads complete Finance Admin report detail with service-computed overdue", async () => {
        findExpenseReportReviewDetailMock.mockResolvedValue({
            expenseReportId,
            owner: ownerId,
            priority: "Urgent",
            dueDate: "2026-07-29",
            status: "AP Review",
            onHold: false,
            isOverdue: false,
            lineItems: [
                {
                    id: "30000000-0000-4000-8000-000000000901",
                    merchant: "Synthetic Air",
                    category: "Travel",
                    date: "2026-07-20",
                    amount: "512.09",
                    currency: "USD",
                    glCode: "6220",
                    flaggedLineItem: true,
                    reviewAction: "approve",
                    deductible: null,
                },
                {
                    id: "30000000-0000-4000-8000-000000000902",
                    merchant: "Synthetic Bistro",
                    category: "Meals",
                    date: "2026-07-21",
                    amount: "48.33",
                    currency: "USD",
                    glCode: "6250",
                    flaggedLineItem: false,
                    reviewAction: null,
                    deductible: null,
                },
            ],
            mileageEntries: [],
            receipts: [],
        });

        const detail = await readExpenseReportReviewDetail({
            id: expenseReportId,
            tenantId,
            now: () => new Date("2026-07-30T12:00:00.000Z"),
        });

        expect(findExpenseReportReviewDetailMock).toHaveBeenCalledWith(
            tenantId,
            expenseReportId,
        );
        expect(detail.isOverdue).toBe(true);
        expect(detail.lineItems).toHaveLength(2);
    });

    void test("reads tenant-scoped receipt bytes without exposing storage keys", async () => {
        const receiptId = "81000000-0000-4000-8000-000000000901";
        findReceiptFileMetadataMock.mockResolvedValue({
            id: receiptId,
            expenseReportId,
            filename: "synthetic-receipt.png",
            contentType: "image/png",
            objectKey: "synthetic/private-object-key",
            sizeBytes: 15,
        });
        receiptStorageMock.get.mockResolvedValue({
            content: new TextEncoder().encode("synthetic image"),
            contentLength: 15,
            contentType: "image/png",
        });

        const file = await readReceiptFile({
            expenseReportId,
            receiptId,
            tenantId,
        });

        expect(findReceiptFileMetadataMock).toHaveBeenCalledWith(
            tenantId,
            expenseReportId,
            receiptId,
        );
        expect(receiptStorageMock.get).toHaveBeenCalledWith(
            "synthetic/private-object-key",
        );
        expect(file).toStrictEqual({
            content: new TextEncoder().encode("synthetic image"),
            contentLength: 15,
            contentType: "image/png",
            filename: "synthetic-receipt.png",
        });
        expect("objectKey" in file).toBe(false);
    });

    void test("adds mileage and computes reimbursement from configuration", async () => {
        insertMileageEntryMock.mockResolvedValue({
            kind: "created",
            entry: {
                id: "70000000-0000-4000-8000-000000000901",
                expenseReportId,
                tenantId,
                route: "Synthetic Office → Synthetic Client Site",
                distance: "12.50",
                mileageDate: "2026-07-23",
                createdAt: new Date("2026-07-24T12:00:00.000Z"),
                updatedAt: new Date("2026-07-24T12:00:00.000Z"),
            },
        });

        const entry = await addMileageEntry({
            id: expenseReportId,
            tenantId,
            actorId: ownerId,
            ownerId,
            route: "Synthetic Office → Synthetic Client Site",
            distance: 12.5,
            mileageDate: "2026-07-23",
        });

        expect(entry.reimbursement).toStrictEqual({
            ratePerMile: 0.7,
            amount: 8.75,
            currency: "USD",
        });
        expect(insertMileageEntryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId,
                expenseReportId,
                ownerId,
                distance: "12.50",
            }),
        );
    });

    void test("rounds half-cent mileage reimbursement exactly", async () => {
        process.env.MILEAGE_REIMBURSEMENT_RATE = "0.50";
        insertMileageEntryMock.mockResolvedValue({
            kind: "created",
            entry: {
                id: "70000000-0000-4000-8000-000000000902",
                expenseReportId,
                tenantId,
                route: "Synthetic Building A → Synthetic Building B",
                distance: "0.01",
                mileageDate: "2026-07-23",
                createdAt: new Date("2026-07-24T12:00:00.000Z"),
                updatedAt: new Date("2026-07-24T12:00:00.000Z"),
            },
        });

        const entry = await addMileageEntry({
            id: expenseReportId,
            tenantId,
            actorId: ownerId,
            ownerId,
            route: "Synthetic Building A → Synthetic Building B",
            distance: 0.01,
            mileageDate: "2026-07-23",
        });

        expect(entry.reimbursement.amount).toBe(0.01);
    });
});

void describe("Expense Report service audit responses", () => {
    void test("rejects audit rows that do not match the outbound response schema", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000801";
        const expenseReportId = "50000000-0000-4000-8000-000000000801";

        findExpenseReportByIdMock.mockResolvedValue({
            id: expenseReportId,
            tenantId,
        });
        findAuditEntriesByExpenseReportIdMock.mockResolvedValue([
            {
                action: "report_created",
                actorId: "60000000-0000-4000-8000-000000000801",
                createdAt: new Date("2026-08-01T12:00:00.000Z"),
                denialReason: null,
                outcomeReason: null,
                expenseReportId,
                id: "70000000-0000-4000-8000-000000000801",
                stageAfterProposedAction: "Drafted",
                stageBeforeAction: "Not A Stage",
                tenantId,
            },
        ]);

        await expect(
            readExpenseReportAuditEntries({
                id: expenseReportId,
                tenantId,
            }),
        ).rejects.toBeInstanceOf(ZodError);
    });
});

void describe("Expense Report service comment responses", () => {
    const tenantId = "40000000-0000-4000-8000-000000000811";
    const expenseReportId = "50000000-0000-4000-8000-000000000811";
    const actorId = "60000000-0000-4000-8000-000000000811";

    void test("reads tenant-scoped comments after verifying the case exists", async () => {
        findExpenseReportByIdMock.mockResolvedValue({
            id: expenseReportId,
            tenantId,
        });
        findCaseCommentsByExpenseReportIdMock.mockResolvedValue([
            {
                id: "70000000-0000-4000-8000-000000000811",
                tenantId,
                expenseReportId,
                authorId: actorId,
                body: "Synthetic dispute note.",
                createdAt: new Date("2026-08-01T12:00:00.000Z"),
            },
        ]);

        await expect(
            readExpenseReportComments({ id: expenseReportId, tenantId }),
        ).resolves.toStrictEqual([
            {
                id: "70000000-0000-4000-8000-000000000811",
                tenantId,
                expenseReportId,
                authorId: actorId,
                body: "Synthetic dispute note.",
                createdAt: new Date("2026-08-01T12:00:00.000Z"),
            },
        ]);
        expect(findCaseCommentsByExpenseReportIdMock).toHaveBeenCalledWith(
            tenantId,
            expenseReportId,
        );
    });

    void test("does not read comments for missing or cross-tenant cases", async () => {
        findExpenseReportByIdMock.mockResolvedValue(undefined);

        await expect(
            readExpenseReportComments({ id: expenseReportId, tenantId }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(findCaseCommentsByExpenseReportIdMock).not.toHaveBeenCalled();
    });

    void test("creates a scoped comment with the authenticated author", async () => {
        insertCaseCommentForExpenseReportMock.mockImplementation((comment) =>
            Promise.resolve({
                ...comment,
                createdAt: new Date("2026-08-01T12:00:00.000Z"),
            }),
        );

        const comment = await createExpenseReportComment({
            id: expenseReportId,
            tenantId,
            authorId: actorId,
            body: "Synthetic dispute note.",
        });

        expect(insertCaseCommentForExpenseReportMock).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId,
                expenseReportId,
                authorId: actorId,
                body: "Synthetic dispute note.",
            }),
            undefined,
        );
        expect(comment).toMatchObject({
            tenantId,
            expenseReportId,
            authorId: actorId,
            body: "Synthetic dispute note.",
        });
    });

    void test("creates Employee comments with owner scope enforced by the write", async () => {
        insertCaseCommentForExpenseReportMock.mockResolvedValue(undefined);

        await expect(
            createExpenseReportComment({
                id: expenseReportId,
                tenantId,
                authorId: actorId,
                ownerId: actorId,
                body: "Synthetic dispute note.",
            }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(insertCaseCommentForExpenseReportMock).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId,
                expenseReportId,
                authorId: actorId,
                body: "Synthetic dispute note.",
            }),
            actorId,
        );
        expect(findExpenseReportByIdMock).not.toHaveBeenCalled();
    });
});

void describe("Expense Report source deductibility service", () => {
    const tenantId = "40000000-0000-4000-8000-000000000902";
    const actorId = "50000000-0000-4000-8000-000000000902";
    const expenseReportId = "60000000-0000-4000-8000-000000000902";
    const sourceId = "70000000-0000-4000-8000-000000000902";

    void test("updates deductibility for an internal AP Review source", async () => {
        findExpenseReportByIdMock.mockResolvedValue({ id: expenseReportId });
        updateExpenseReportSourceDeductibilityMock.mockResolvedValue({
            kind: "updated",
            lineItem: {
                id: sourceId,
                sourceType: "line_item",
                expenseReportId,
                employee: actorId,
                merchant: "Synthetic Hotel",
                amount: 42,
                glCode: "6000",
                currentStage: "AP Review",
                flaggedLineItem: false,
                policyChecks: [],
                reviewAction: "approve",
                deductible: true,
                canAdvance: false,
                reportTotalMileage: 0,
                mileageEntries: [],
                receipts: [],
            },
        });

        const result = await updateExpenseReportSourceDeductibility({
            id: expenseReportId,
            sourceType: "line_item",
            sourceId,
            tenantId,
            actorId,
            roles: ["Department Manager"],
            deductible: true,
        });

        expect(result.deductible).toBe(true);
        expect(updateExpenseReportSourceDeductibilityMock).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId,
                expenseReportId,
                sourceId,
                sourceType: "line_item",
                actorId,
                deductible: true,
            }),
        );
    });

    void test("rejects deductibility updates for roles outside workflow review", async () => {
        findExpenseReportByIdMock.mockResolvedValue({ id: expenseReportId });

        await expect(
            updateExpenseReportSourceDeductibility({
                id: expenseReportId,
                sourceType: "line_item",
                sourceId,
                tenantId,
                actorId,
                roles: ["Employee"],
                deductible: true,
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(
            updateExpenseReportSourceDeductibilityMock,
        ).not.toHaveBeenCalled();
    });

    void test("maps missing reports and sources to not found", async () => {
        findExpenseReportByIdMock.mockResolvedValueOnce(undefined);

        await expect(
            updateExpenseReportSourceDeductibility({
                id: expenseReportId,
                sourceType: "line_item",
                sourceId,
                tenantId,
                actorId,
                roles: ["Department Manager"],
                deductible: true,
            }),
        ).rejects.toBeInstanceOf(NotFoundError);

        findExpenseReportByIdMock.mockResolvedValueOnce({
            id: expenseReportId,
        });
        updateExpenseReportSourceDeductibilityMock.mockResolvedValueOnce({
            kind: "not_found",
        });

        await expect(
            updateExpenseReportSourceDeductibility({
                id: expenseReportId,
                sourceType: "line_item",
                sourceId,
                tenantId,
                actorId,
                roles: ["Department Manager"],
                deductible: true,
            }),
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    void test("maps non-AP Review store results to conflict", async () => {
        findExpenseReportByIdMock.mockResolvedValue({ id: expenseReportId });
        updateExpenseReportSourceDeductibilityMock.mockResolvedValue({
            kind: "invalid_stage",
            currentStage: "Manager Approval",
        });

        await expect(
            updateExpenseReportSourceDeductibility({
                id: expenseReportId,
                sourceType: "line_item",
                sourceId,
                tenantId,
                actorId,
                roles: ["Department Manager"],
                deductible: true,
            }),
        ).rejects.toBeInstanceOf(ConflictError);
    });
});
