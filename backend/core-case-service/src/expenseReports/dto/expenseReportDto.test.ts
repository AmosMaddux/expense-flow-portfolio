import { describe, expect, test } from "vitest";

import {
    CreateExpenseReportInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    GetExpenseReportInboundRequestSchema,
    type CreateExpenseReportRequest,
    type ExpenseReportResponse,
    type GetExpenseReportRequest,
} from "./expenseReportDto.js";

const validCreateExpenseReportRequest = {
    tenant_id: "10000000-0000-4000-8000-000000000100",
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
    createdAt: new Date("2026-07-06T12:00:00.000Z"),
    updatedAt: new Date("2026-07-06T12:00:00.000Z"),
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

    void test("requires tenant scope using the database-backed tenant_id field", () => {
        const parsed = CreateExpenseReportInboundRequestSchema.parse(
            validCreateExpenseReportRequest,
        );

        expect(parsed.tenant_id).toBe(
            validCreateExpenseReportRequest.tenant_id,
        );
    });

    void test("keeps camelCase tenant scope out of the inbound create request contract", () => {
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
                tenant_id: validCreateExpenseReportRequest.tenant_id,
            }),
        ).toThrow();
    });

    void test("rejects invalid identifiers and dates", () => {
        expect(() =>
            CreateExpenseReportInboundRequestSchema.parse({
                tenant_id: validCreateExpenseReportRequest.tenant_id,
                owner: validCreateExpenseReportRequest.owner,
                dueDate: "July 31, 2026",
            }),
        ).toThrow();
    });
});

void describe("GetExpenseReportInboundRequestSchema", () => {
    void test("parses the read request shape by id", () => {
        const parsed: GetExpenseReportRequest =
            GetExpenseReportInboundRequestSchema.parse({
                id: "30000000-0000-4000-8000-000000000001",
            });

        expect(parsed).toStrictEqual({
            id: "30000000-0000-4000-8000-000000000001",
        });
    });

    void test("rejects read requests with an invalid id", () => {
        expect(() =>
            GetExpenseReportInboundRequestSchema.parse({
                id: "expense-report-one",
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
