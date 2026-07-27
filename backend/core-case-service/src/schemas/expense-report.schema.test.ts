import { describe, expect, test } from "vitest";

import {
    AddDraftExpenseContentInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    GetExpenseReportInboundRequestSchema,
    createAddDraftExpenseContentInboundRequestSchema,
    type CreateExpenseReportRequest,
    type ExpenseReportResponse,
    type GetExpenseReportRequest,
} from "./expense-report.schema.js";

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

    void test("rejects workflow stage in the inbound create request contract", () => {
        expect(() =>
            CreateExpenseReportInboundRequestSchema.parse({
                ...validCreateExpenseReportRequest,
                currentStage: "Submitted",
            }),
        ).toThrow();
    });

    void test("rejects client-supplied tenant scope in the create contract", () => {
        expect(() =>
            CreateExpenseReportInboundRequestSchema.parse({
                ...validCreateExpenseReportRequest,
                tenant_id: validExpenseReportResponse.tenantId,
            }),
        ).toThrow();
        expect(() =>
            CreateExpenseReportInboundRequestSchema.parse({
                ...validCreateExpenseReportRequest,
                tenantId: validExpenseReportResponse.tenantId,
            }),
        ).toThrow();
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

void describe("AddDraftExpenseContentInboundRequestSchema", () => {
    const validRequest = {
        lineItems: [
            {
                merchant: "Synthetic Conference Center",
                expenseDate: "2026-07-23",
                category: "Travel",
                amount: 125.5,
                currency: "USD",
            },
        ],
        receipts: [
            {
                lineItemIndex: 0,
                uploadId: "30000000-0000-4000-8000-000000000001",
                filename: "synthetic-receipt.pdf",
                contentType: "application/pdf",
                sizeBytes: 2048,
            },
        ],
    };

    void test("validates line items and receipt references", () => {
        expect(
            AddDraftExpenseContentInboundRequestSchema.parse(validRequest),
        ).toStrictEqual(validRequest);
    });

    void test("rejects a receipt that does not reference a line item", () => {
        expect(() =>
            AddDraftExpenseContentInboundRequestSchema.parse({
                ...validRequest,
                receipts: [
                    {
                        ...validRequest.receipts[0],
                        lineItemIndex: 1,
                    },
                ],
            }),
        ).toThrow("Receipt must reference a submitted line item.");
    });

    void test("rejects unsupported receipt content and invalid amounts", () => {
        expect(() =>
            AddDraftExpenseContentInboundRequestSchema.parse({
                lineItems: [
                    {
                        ...validRequest.lineItems[0],
                        amount: -1,
                    },
                ],
                receipts: [
                    {
                        ...validRequest.receipts[0],
                        contentType: "application/octet-stream",
                    },
                ],
            }),
        ).toThrow();
    });

    void test("rejects future expense dates using the backend clock", () => {
        const schema = createAddDraftExpenseContentInboundRequestSchema(
            () => new Date("2026-07-25T12:00:00.000Z"),
        );

        expect(() =>
            schema.parse({
                ...validRequest,
                lineItems: [
                    {
                        ...validRequest.lineItems[0],
                        expenseDate: "2026-07-26",
                    },
                ],
            }),
        ).toThrow("Expense date cannot be in the future.");
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
