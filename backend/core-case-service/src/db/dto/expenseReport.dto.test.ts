import { describe, expect, test } from "vitest";

import {
    CreateExpenseReportInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    type CreateExpenseReportRequest,
    type ExpenseReportResponse,
} from "./expenseReport.dto.js";

const validCreateExpenseReportRequest = {
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

void describe("CreateExpenseReportInboundRequestSchema", () => {
    void test("parses the inbound fields needed to open a Drafted Expense Report", () => {
        const parsed: CreateExpenseReportRequest =
            CreateExpenseReportInboundRequestSchema.parse(
                validCreateExpenseReportRequest,
            );

        expect(parsed).toStrictEqual({
            ...validCreateExpenseReportRequest,
            priority: "Normal",
        });
    });

    void test("keeps workflow stage out of the inbound create request contract", () => {
        const parsed = CreateExpenseReportInboundRequestSchema.parse({
            ...validCreateExpenseReportRequest,
            currentStage: "Submitted",
        });

        expect(parsed).not.toHaveProperty("currentStage");
    });

    void test("keeps tenant scope out of the inbound create request contract", () => {
        const parsed = CreateExpenseReportInboundRequestSchema.parse({
            ...validCreateExpenseReportRequest,
            tenantId: validExpenseReportResponse.tenantId,
        });

        expect(parsed).not.toHaveProperty("tenantId");
    });

    void test("accepts an explicit priority", () => {
        const parsed = CreateExpenseReportInboundRequestSchema.parse({
            ...validCreateExpenseReportRequest,
            priority: "High",
        });

        expect(parsed.priority).toBe("High");
    });

    void test("rejects requests missing required Drafted-report fields", () => {
        expect(() =>
            CreateExpenseReportInboundRequestSchema.parse({
                dueDate: validCreateExpenseReportRequest.dueDate,
            }),
        ).toThrow();
    });

    void test("rejects invalid identifiers and dates", () => {
        expect(() =>
            CreateExpenseReportInboundRequestSchema.parse({
                owner: "owner-one",
                dueDate: "07/31/2026",
            }),
        ).toThrow();
    });
});

void describe("ExpenseReportOutboundResponseSchema", () => {
    void test("parses the outbound API response report shape", () => {
        const parsed: ExpenseReportResponse =
            ExpenseReportOutboundResponseSchema.parse(
                validExpenseReportResponse,
            );

        expect(parsed).toStrictEqual(validExpenseReportResponse);
    });

    void test("rejects responses with an unknown workflow stage", () => {
        expect(() =>
            ExpenseReportOutboundResponseSchema.parse({
                ...validExpenseReportResponse,
                currentStage: "Rejected",
            }),
        ).toThrow();
    });

    void test("rejects responses with invalid timestamp fields", () => {
        expect(() =>
            ExpenseReportOutboundResponseSchema.parse({
                ...validExpenseReportResponse,
                createdAt: "2026-07-06",
            }),
        ).toThrow();
    });
});
