import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";

const findAuditEntriesByExpenseReportIdMock = vi.hoisted(() => vi.fn());
const findCurrentDraftExpenseReportMock = vi.hoisted(() => vi.fn());
const findExpenseReportByIdMock = vi.hoisted(() => vi.fn());
const insertMileageEntryMock = vi.hoisted(() => vi.fn());

vi.mock("../repository/expenseReportRepository.js", () => ({
    buildSubmissionSourceFingerprint: vi.fn(),
    buildSubmissionSourceKeys: vi.fn(),
    clearExpenseReportFlags: vi.fn(),
    countOpenExpenseReportFlags: vi.fn(),
    findAuditEntriesByExpenseReportId: findAuditEntriesByExpenseReportIdMock,
    findCurrentDraftExpenseReport: findCurrentDraftExpenseReportMock,
    findExpenseReportById: findExpenseReportByIdMock,
    insertDeniedSubmissionAuditEntry: vi.fn(),
    insertDeniedWorkflowTransitionAttempt: vi.fn(),
    insertDraftExpenseReport: vi.fn(),
    insertMileageEntry: insertMileageEntryMock,
    readDraftSubmissionSources: vi.fn(),
    submitDraftExpenseReport: vi.fn(),
    transitionExpenseReportStage: vi.fn(),
}));

import {
    addMileageEntry,
    readCurrentDraftExpenseReport,
    readExpenseReportAuditEntries,
} from "./expenseReportService.js";

const originalMileageRate = process.env.MILEAGE_REIMBURSEMENT_RATE;

beforeEach(() => {
    process.env.MILEAGE_REIMBURSEMENT_RATE = "0.70";
    findCurrentDraftExpenseReportMock.mockReset();
    insertMileageEntryMock.mockReset();
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
