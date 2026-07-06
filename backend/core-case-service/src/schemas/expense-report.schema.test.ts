import { describe, expect, test } from "vitest";

import {
    createExpenseReportRequestSchema,
    expenseReportResponseSchema,
    type CreateExpenseReportRequest,
    type ExpenseReportResponse,
} from "./expense-report.schema.js";

const validCreateExpenseReportRequest = {
    tenantId: "10000000-0000-4000-8000-000000000100",
    owner: "20000000-0000-4000-8000-000000000001",
    dueDate: "2026-07-31",
};

const validExpenseReportResponse = {
    id: "30000000-0000-4000-8000-000000000001",
    tenantId: "10000000-0000-4000-8000-000000000100",
    owner: "20000000-0000-4000-8000-000000000001",
    dueDate: "2026-07-31",
    priority: "Normal",
    currentStage: "Drafted",
    onHold: false,
    holdReason: null,
    createdAt: "2026-07-06T12:00:00.000Z",
    updatedAt: "2026-07-06T12:00:00.000Z",
};

void describe("createExpenseReportRequestSchema", () => {
    void test("parses the fields needed to open a Drafted Expense Report", () => {
        const parsed: CreateExpenseReportRequest =
            createExpenseReportRequestSchema.parse(
                validCreateExpenseReportRequest,
            );

        expect(parsed).toStrictEqual({
            ...validCreateExpenseReportRequest,
            priority: "Normal",
        });
    });

    void test("accepts an explicit priority", () => {
        const parsed = createExpenseReportRequestSchema.parse({
            ...validCreateExpenseReportRequest,
            priority: "High",
        });

        expect(parsed.priority).toBe("High");
    });

    void test("rejects requests missing required Drafted-report fields", () => {
        expect(() =>
            createExpenseReportRequestSchema.parse({
                tenantId: validCreateExpenseReportRequest.tenantId,
                dueDate: validCreateExpenseReportRequest.dueDate,
            }),
        ).toThrow();
    });

    void test("rejects invalid identifiers and dates", () => {
        expect(() =>
            createExpenseReportRequestSchema.parse({
                tenantId: "tenant-one",
                owner: validCreateExpenseReportRequest.owner,
                dueDate: "07/31/2026",
            }),
        ).toThrow();
    });
});

void describe("expenseReportResponseSchema", () => {
    void test("parses the API response report shape", () => {
        const parsed: ExpenseReportResponse = expenseReportResponseSchema.parse(
            validExpenseReportResponse,
        );

        expect(parsed).toStrictEqual(validExpenseReportResponse);
    });

    void test("rejects responses with an unknown workflow stage", () => {
        expect(() =>
            expenseReportResponseSchema.parse({
                ...validExpenseReportResponse,
                currentStage: "Rejected",
            }),
        ).toThrow();
    });

    void test("rejects responses with invalid timestamp fields", () => {
        expect(() =>
            expenseReportResponseSchema.parse({
                ...validExpenseReportResponse,
                createdAt: "2026-07-06",
            }),
        ).toThrow();
    });
});
