import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from "../../errors/problem-json.js";

const findAuditEntriesByExpenseReportIdMock = vi.hoisted(() => vi.fn());
const findCurrentDraftExpenseReportMock = vi.hoisted(() => vi.fn());
const findExpenseReportByIdMock = vi.hoisted(() => vi.fn());
const findExpenseReportReviewDetailMock = vi.hoisted(() => vi.fn());
const insertMileageEntryMock = vi.hoisted(() => vi.fn());
const claimExpenseReportSettlementMock = vi.hoisted(() => vi.fn());
const markExpenseReportSettlementCompensatedMock = vi.hoisted(() => vi.fn());
const markExpenseReportSettlementReconciledMock = vi.hoisted(() => vi.fn());
const recordExpenseReportSettlementPaymentMock = vi.hoisted(() => vi.fn());
const transitionExpenseReportStageMock = vi.hoisted(() => vi.fn());
const compensatePaidSettlementStageMock = vi.hoisted(() => vi.fn());
const invalidateCachedCaseQueueStageRollupsMock = vi.hoisted(() => vi.fn());
const updateExpenseReportSourceDeductibilityMock = vi.hoisted(() => vi.fn());

vi.mock("../repository/expenseReportRepository.js", () => ({
    buildSubmissionSourceFingerprint: vi.fn(),
    buildSubmissionSourceKeys: vi.fn(),
    clearExpenseReportFlags: vi.fn(),
    claimExpenseReportSettlement: claimExpenseReportSettlementMock,
    compensatePaidSettlementStage: compensatePaidSettlementStageMock,
    countOpenExpenseReportFlags: vi.fn(),
    findApprovalQueueLineItems: vi.fn(),
    findAuditEntriesByExpenseReportId: findAuditEntriesByExpenseReportIdMock,
    findCurrentDraftExpenseReport: findCurrentDraftExpenseReportMock,
    findExpenseReportById: findExpenseReportByIdMock,
    findExpenseReportReviewDetail: findExpenseReportReviewDetailMock,
    insertDeniedSubmissionAuditEntry: vi.fn(),
    insertDeniedWorkflowTransitionAttempt: vi.fn(),
    insertDraftExpenseReport: vi.fn(),
    insertMileageEntry: insertMileageEntryMock,
    markExpenseReportSettlementCompensated:
        markExpenseReportSettlementCompensatedMock,
    markExpenseReportSettlementReconciled:
        markExpenseReportSettlementReconciledMock,
    readDraftSubmissionSources: vi.fn(),
    recordExpenseReportSettlementPayment:
        recordExpenseReportSettlementPaymentMock,
    reviewExpenseReportLineItem: vi.fn(),
    submitDraftExpenseReport: vi.fn(),
    transitionExpenseReportStage: transitionExpenseReportStageMock,
    updateExpenseReportSourceDeductibility:
        updateExpenseReportSourceDeductibilityMock,
}));

vi.mock("./caseQueueService.js", () => ({
    invalidateCachedCaseQueueStageRollups:
        invalidateCachedCaseQueueStageRollupsMock,
}));

import {
    addMileageEntry,
    updateExpenseReportSourceDeductibility,
    readCurrentDraftExpenseReport,
    readExpenseReportAuditEntries,
    readExpenseReportReviewDetail,
    settleExpenseReportWorkflow,
    transitionExpenseReportWorkflow,
} from "./expenseReportService.js";

const originalMileageRate = process.env.MILEAGE_REIMBURSEMENT_RATE;

beforeEach(() => {
    process.env.MILEAGE_REIMBURSEMENT_RATE = "0.70";
    findCurrentDraftExpenseReportMock.mockReset();
    findExpenseReportByIdMock.mockReset();
    findExpenseReportReviewDetailMock.mockReset();
    insertMileageEntryMock.mockReset();
    claimExpenseReportSettlementMock.mockReset();
    markExpenseReportSettlementCompensatedMock.mockReset();
    markExpenseReportSettlementReconciledMock.mockReset();
    recordExpenseReportSettlementPaymentMock.mockReset();
    transitionExpenseReportStageMock.mockReset();
    compensatePaidSettlementStageMock.mockReset();
    invalidateCachedCaseQueueStageRollupsMock.mockReset();
    updateExpenseReportSourceDeductibilityMock.mockReset();
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
});

void describe("Expense Report settlement saga", () => {
    const tenantId = "40000000-0000-4000-8000-000000000811";
    const actorId = "50000000-0000-4000-8000-000000000811";
    const expenseReportId = "60000000-0000-4000-8000-000000000811";
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
        markExpenseReportSettlementReconciledMock.mockResolvedValue(true);
        transitionExpenseReportStageMock.mockResolvedValue(true);
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
        expect(transitionExpenseReportStageMock).toHaveBeenCalledTimes(2);
        expect(transitionExpenseReportStageMock).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                fromStage: "AP Review",
                toStage: "Paid",
                reason: "payment_stub_issued",
            }),
        );
        expect(transitionExpenseReportStageMock).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                fromStage: "Paid",
                toStage: "Reconciled",
                reason: "Synthetic settlement complete.",
            }),
        );
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
                paymentId: null,
            },
        });
        recordExpenseReportSettlementPaymentMock.mockResolvedValue({
            kind: "recorded",
            settlement: {
                paymentId: "synthetic-payment-rollback",
            },
        });
        transitionExpenseReportStageMock
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
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
                eventId: expect.any(String),
                occurredAt: expect.any(Date),
            }),
        );
        expect(markExpenseReportSettlementCompensatedMock).toHaveBeenCalledWith({
            tenantId,
            id: expenseReportId,
            paymentId: "synthetic-payment-rollback",
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
                reviewAction: "approve",
                deductible: true,
                canAdvance: false,
                reportTotalMileage: 0,
                mileageEntries: [],
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
