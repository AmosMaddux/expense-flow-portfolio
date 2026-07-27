import { describe, expect, test, vi } from "vitest";

import type { ExpenseReport } from "../../db/schema/index.js";
import { readMySubmissions } from "./mySubmissionsService.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";

function buildReport(overrides: Partial<ExpenseReport> = {}): ExpenseReport {
    return {
        id: "30000000-0000-4000-8000-000000000001",
        tenantId,
        owner: ownerId,
        dueDate: "2026-07-26",
        priority: "Normal",
        currentStage: "Manager Approval",
        onHold: false,
        holdReason: null,
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        updatedAt: new Date("2026-07-21T12:00:00.000Z"),
        ...overrides,
    };
}

describe("readMySubmissions", () => {
    test("passes authenticated tenant and owner scope to the store", async () => {
        const findByOwner = vi.fn().mockResolvedValue([]);

        await readMySubmissions(
            { tenantId, ownerId },
            {
                now: () => new Date("2026-07-27T12:00:00.000Z"),
                store: { findByOwner },
            },
        );

        expect(findByOwner).toHaveBeenCalledExactlyOnceWith(tenantId, ownerId);
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
            { tenantId, ownerId },
            {
                now: () => new Date("2026-07-27T12:00:00.000Z"),
                store: { findByOwner: vi.fn().mockResolvedValue(reports) },
            },
        );

        expect(result.map(({ id, isOverdue }) => ({ id, isOverdue }))).toEqual([
            { id: reports[0]?.id, isOverdue: true },
            { id: reports[1]?.id, isOverdue: false },
            { id: reports[2]?.id, isOverdue: false },
        ]);
    });

    test("does not expose tenant or owner identifiers in list items", async () => {
        const result = await readMySubmissions(
            { tenantId, ownerId },
            {
                store: {
                    findByOwner: vi.fn().mockResolvedValue([buildReport()]),
                },
            },
        );

        expect(result[0]).not.toHaveProperty("tenantId");
        expect(result[0]).not.toHaveProperty("owner");
    });
});
