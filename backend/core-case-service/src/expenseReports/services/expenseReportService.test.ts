import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ExpenseReport } from "../../db/schema/index.js";

const repositoryMocks = vi.hoisted(() => ({
    findExpenseReportById: vi.fn(),
    insertDraftExpenseReport: vi.fn(),
    transitionExpenseReportStage: vi.fn(),
}));

vi.mock("../repository/expenseReportRepository.js", () => repositoryMocks);

const { transitionExpenseReportWorkflow } =
    await import("./expenseReportService.js");

const draftedReport: ExpenseReport = {
    id: "30000000-0000-4000-8000-000000000300",
    tenantId: "10000000-0000-4000-8000-000000000300",
    owner: "20000000-0000-4000-8000-000000000300",
    dueDate: "2026-08-12",
    priority: "Normal",
    currentStage: "Drafted",
    onHold: false,
    holdReason: null,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
};

const submittedReport: ExpenseReport = {
    ...draftedReport,
    currentStage: "Submitted",
    updatedAt: new Date("2026-08-01T12:05:00.000Z"),
};

void describe("transitionExpenseReportWorkflow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    void test("does not dispatch an event when the transactional stage change rolls back", async () => {
        const dispatcher = vi.fn();
        repositoryMocks.findExpenseReportById.mockResolvedValue(draftedReport);
        repositoryMocks.transitionExpenseReportStage.mockRejectedValue(
            new Error("rollback"),
        );

        await expect(
            transitionExpenseReportWorkflow(
                {
                    id: draftedReport.id,
                    tenantId: draftedReport.tenantId,
                    actor: draftedReport.owner,
                    toStage: "Submitted",
                    reason: "employee submitted report",
                },
                { dispatcher },
            ),
        ).rejects.toThrow("rollback");

        expect(dispatcher).not.toHaveBeenCalled();
    });

    void test("dispatches the durable outbox row after a successful stage change", async () => {
        const dispatcher = vi.fn().mockResolvedValue(1);
        repositoryMocks.findExpenseReportById
            .mockResolvedValueOnce(draftedReport)
            .mockResolvedValueOnce(submittedReport);
        repositoryMocks.transitionExpenseReportStage.mockResolvedValue(true);

        const response = await transitionExpenseReportWorkflow(
            {
                id: draftedReport.id,
                tenantId: draftedReport.tenantId,
                actor: draftedReport.owner,
                toStage: "Submitted",
                reason: "employee submitted report",
            },
            { dispatcher },
        );

        expect(response.currentStage).toBe("Submitted");
        expect(
            repositoryMocks.transitionExpenseReportStage,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: draftedReport.id,
                tenantId: draftedReport.tenantId,
                fromStage: "Drafted",
                toStage: "Submitted",
            }),
        );
        expect(dispatcher).toHaveBeenCalledTimes(1);
        expect(dispatcher).toHaveBeenCalledWith(expect.any(String), undefined);
    });

    void test("returns the transitioned report even when immediate dispatch fails", async () => {
        const dispatcher = vi.fn().mockRejectedValue(new Error("sns down"));
        repositoryMocks.findExpenseReportById
            .mockResolvedValueOnce(draftedReport)
            .mockResolvedValueOnce(submittedReport);
        repositoryMocks.transitionExpenseReportStage.mockResolvedValue(true);

        const response = await transitionExpenseReportWorkflow(
            {
                id: draftedReport.id,
                tenantId: draftedReport.tenantId,
                actor: draftedReport.owner,
                toStage: "Submitted",
                reason: "employee submitted report",
            },
            { dispatcher },
        );

        expect(response.currentStage).toBe("Submitted");
    });
});
