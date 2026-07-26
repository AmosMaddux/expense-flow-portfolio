import { describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";

const findAuditEntriesByExpenseReportIdMock = vi.hoisted(() => vi.fn());
const findExpenseReportByIdMock = vi.hoisted(() => vi.fn());

vi.mock("../repository/expenseReportRepository.js", () => ({
    buildSubmissionSourceFingerprint: vi.fn(),
    buildSubmissionSourceKeys: vi.fn(),
    clearExpenseReportFlags: vi.fn(),
    countOpenExpenseReportFlags: vi.fn(),
    findApprovalQueueLineItems: vi.fn(),
    findAuditEntriesByExpenseReportId: findAuditEntriesByExpenseReportIdMock,
    findExpenseReportById: findExpenseReportByIdMock,
    insertDeniedSubmissionAuditEntry: vi.fn(),
    insertDeniedWorkflowTransitionAttempt: vi.fn(),
    insertDraftExpenseReport: vi.fn(),
    readDraftSubmissionSources: vi.fn(),
    reviewExpenseReportLineItem: vi.fn(),
    submitDraftExpenseReport: vi.fn(),
    transitionExpenseReportStage: vi.fn(),
}));

import { readExpenseReportAuditEntries } from "./expenseReportService.js";

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
