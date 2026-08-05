import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { EmployeeSubmissionSummary } from "../repository/expenseReportRepository.js";
import {
    readMySubmissionDetail,
    readMySubmissions,
} from "./mySubmissionsService.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
    vi.stubEnv("MILEAGE_REIMBURSEMENT_RATE", "0.67");
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function buildReport(
    overrides: Partial<EmployeeSubmissionSummary> = {},
): EmployeeSubmissionSummary {
    return {
        id: "30000000-0000-4000-8000-000000000001",
        tenantId,
        owner: ownerId,
        dueDate: "2026-07-26",
        priority: "Normal",
        currentStage: "Manager Approval",
        isSentBack: false,
        onHold: false,
        holdReason: null,
        employerEin: null,
        employerLegalName: null,
        employerEinValidationStatus: null,
        employerEinValidationReason: null,
        employerEinServiceReferenceId: null,
        employerEinValidatedAt: null,
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        updatedAt: new Date("2026-07-21T12:00:00.000Z"),
        ...overrides,
    };
}

describe("readMySubmissions", () => {
    test("passes authenticated tenant and owner scope to the store", async () => {
        const findByOwner = vi.fn().mockResolvedValue([]);

        await readMySubmissions(
            { tenantId, ownerId, pageSize: 25 },
            {
                now: () => new Date("2026-07-27T12:00:00.000Z"),
                store: { findByOwner },
            },
        );

        expect(findByOwner).toHaveBeenCalledExactlyOnceWith(tenantId, ownerId, {
            limit: 26,
        });
    });

    test("marks only past-due non-terminal reports as overdue", async () => {
        const reports = [
            buildReport(),
            buildReport({
                id: "30000000-0000-4000-8000-000000000002",
                dueDate: "2026-07-27",
                currentStage: "Submitted",
            }),
            buildReport({
                id: "30000000-0000-4000-8000-000000000003",
                dueDate: "2026-07-20",
                currentStage: "Reconciled",
            }),
        ];

        const result = await readMySubmissions(
            { tenantId, ownerId, pageSize: 25 },
            {
                now: () => new Date("2026-07-27T12:00:00.000Z"),
                store: { findByOwner: vi.fn().mockResolvedValue(reports) },
            },
        );

        expect(
            result.items.map(({ id, isOverdue }) => ({ id, isOverdue })),
        ).toEqual([
            { id: reports[0]?.id, isOverdue: true },
            { id: reports[1]?.id, isOverdue: false },
            { id: reports[2]?.id, isOverdue: false },
        ]);
    });

    test("does not expose tenant or owner identifiers in list items", async () => {
        const result = await readMySubmissions(
            { tenantId, ownerId, pageSize: 25 },
            {
                store: {
                    findByOwner: vi.fn().mockResolvedValue([buildReport()]),
                },
            },
        );

        expect(result.items[0]).not.toHaveProperty("tenantId");
        expect(result.items[0]).not.toHaveProperty("owner");
    });

    test("identifies a Drafted report that was sent back", async () => {
        const result = await readMySubmissions(
            { tenantId, ownerId, pageSize: 25 },
            {
                store: {
                    findByOwner: vi.fn().mockResolvedValue([
                        buildReport({
                            currentStage: "Drafted",
                            isSentBack: true,
                        }),
                    ]),
                },
            },
        );

        expect(result.items[0]?.isSentBack).toBe(true);
    });

    test("returns an opaque cursor and decodes it for the next page", async () => {
        const reports = [
            buildReport({
                id: "30000000-0000-4000-8000-000000000011",
                createdAt: new Date("2026-07-22T12:00:00.000Z"),
                updatedAt: new Date("2026-07-23T12:00:00.000Z"),
            }),
            buildReport({
                id: "30000000-0000-4000-8000-000000000012",
                createdAt: new Date("2026-07-21T12:00:00.000Z"),
                updatedAt: new Date("2026-07-22T12:00:00.000Z"),
            }),
        ];
        const firstStore = vi.fn().mockResolvedValue(reports);
        const firstPage = await readMySubmissions(
            { tenantId, ownerId, pageSize: 1 },
            { store: { findByOwner: firstStore } },
        );
        if (firstPage.nextCursor === null) {
            throw new Error("Expected another My Submissions page.");
        }
        const secondStore = vi.fn().mockResolvedValue([]);

        await readMySubmissions(
            {
                tenantId,
                ownerId,
                pageSize: 1,
                cursor: firstPage.nextCursor,
            },
            { store: { findByOwner: secondStore } },
        );

        expect(firstPage.items).toHaveLength(1);
        expect(secondStore).toHaveBeenCalledExactlyOnceWith(tenantId, ownerId, {
            cursor: {
                id: reports[0]?.id,
                createdAt: reports[0]?.createdAt,
                updatedAt: reports[0]?.updatedAt,
            },
            limit: 2,
        });
    });
});

describe("readMySubmissionDetail", () => {
    test("scopes the detail read and maps line items and mileage", async () => {
        const reportId = "30000000-0000-4000-8000-000000000010";
        const findDetail = vi.fn().mockResolvedValue({
            report: buildReport({
                id: reportId,
                employerEin: "123456789",
                employerLegalName: "Synthetic Employer LLC",
                employerEinValidationStatus: "invalid",
                employerEinValidationReason:
                    "Synthetic EIN and legal name mismatch.",
                employerEinServiceReferenceId: "synthetic-reference-010",
                employerEinValidatedAt: new Date("2026-07-30T12:00:00.000Z"),
            }),
            rejectionReason: "Receipt does not match the submitted amount.",
            lineItems: [
                {
                    id: "40000000-0000-4000-8000-000000000010",
                    tenantId,
                    expenseReportId: reportId,
                    merchant: "Synthetic Rail",
                    expenseDate: "2026-07-18",
                    category: "Travel",
                    amount: "84.25",
                    currency: "USD",
                    reviewAction: "reject",
                    createdAt: new Date("2026-07-18T12:00:00.000Z"),
                    updatedAt: new Date("2026-07-18T12:00:00.000Z"),
                },
            ],
            mileageEntries: [
                {
                    id: "50000000-0000-4000-8000-000000000010",
                    tenantId,
                    expenseReportId: reportId,
                    route: "Synthetic Office to Client Site",
                    distance: "10.00",
                    mileageDate: "2026-07-19",
                    reviewAction: "approve",
                    createdAt: new Date("2026-07-19T12:00:00.000Z"),
                    updatedAt: new Date("2026-07-19T12:00:00.000Z"),
                },
            ],
        });

        const detail = await readMySubmissionDetail(
            { id: reportId, tenantId, ownerId },
            { findDetail },
        );

        expect(findDetail).toHaveBeenCalledExactlyOnceWith(
            tenantId,
            reportId,
            ownerId,
        );
        expect(detail.lineItems[0]).toMatchObject({
            merchant: "Synthetic Rail",
            amount: 84.25,
            reviewAction: "reject",
        });
        expect(detail.rejectionReason).toBe(
            "Receipt does not match the submitted amount.",
        );
        expect(detail.employerEinValidation).toStrictEqual({
            status: "invalid",
            isValid: false,
            reason: "Synthetic EIN and legal name mismatch.",
            serviceReferenceId: "synthetic-reference-010",
            validatedAt: new Date("2026-07-30T12:00:00.000Z"),
        });
        expect(detail.mileageEntries[0]).toMatchObject({
            distance: 10,
            currency: "USD",
            reviewAction: "approve",
        });
    });

    test("does not require mileage configuration for line-item-only details", async () => {
        vi.stubEnv("MILEAGE_REIMBURSEMENT_RATE", "");
        const reportId = "30000000-0000-4000-8000-000000000020";

        const detail = await readMySubmissionDetail(
            { id: reportId, tenantId, ownerId },
            {
                findDetail: vi.fn().mockResolvedValue({
                    report: buildReport({ id: reportId }),
                    rejectionReason: null,
                    lineItems: [],
                    mileageEntries: [],
                }),
            },
        );

        expect(detail.mileageEntries).toEqual([]);
    });
});
