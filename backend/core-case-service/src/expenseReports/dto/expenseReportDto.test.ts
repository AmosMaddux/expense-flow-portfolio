import { describe, expect, test } from "vitest";

import {
    AuditEntryListOutboundResponseSchema,
    AuditEntryOutboundResponseSchema,
    ApprovalQueueLineItemOutboundResponseSchema,
    CaseCommentListOutboundResponseSchema,
    CaseCommentOutboundResponseSchema,
    ClearExpenseReportFlagsInboundRequestSchema,
    CreateCaseCommentInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    CreateMileageEntryInboundRequestSchema,
    createMileageEntryInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    GetExpenseReportInboundRequestSchema,
    type AuditEntryResponse,
    type ApprovalQueueLineItemResponse,
    type CaseCommentResponse,
    type CreateCaseCommentRequest,
    type CreateExpenseReportRequest,
    type ExpenseReportResponse,
    type GetExpenseReportRequest,
} from "./expenseReportDto.js";

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

const validAuditEntryResponse = {
    id: "31000000-0000-4000-8000-000000000001",
    tenantId: validExpenseReportResponse.tenantId,
    expenseReportId: validExpenseReportResponse.id,
    actorId: validCreateExpenseReportRequest.owner,
    action: "report_created",
    stageBeforeAction: "Drafted",
    stageAfterProposedAction: "Drafted",
    denialReason: null,
    outcomeReason: null,
    createdAt: new Date("2026-07-06T12:00:01.000Z"),
};

const validCaseCommentResponse = {
    id: "32000000-0000-4000-8000-000000000001",
    tenantId: validExpenseReportResponse.tenantId,
    expenseReportId: validExpenseReportResponse.id,
    authorId: validCreateExpenseReportRequest.owner,
    body: "Synthetic dispute note for review.",
    createdAt: new Date("2026-07-06T12:00:02.000Z"),
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

void describe("CreateMileageEntryInboundRequestSchema", () => {
    void test("parses route, distance, and date", () => {
        expect(
            CreateMileageEntryInboundRequestSchema.parse({
                route: "Synthetic Office → Synthetic Client Site",
                distance: 12.5,
                mileageDate: "2026-07-23",
            }),
        ).toStrictEqual({
            route: "Synthetic Office → Synthetic Client Site",
            distance: 12.5,
            mileageDate: "2026-07-23",
        });
    });

    void test("rejects zero distance, malformed dates, and tenant scope", () => {
        expect(() =>
            CreateMileageEntryInboundRequestSchema.parse({
                route: "Synthetic Office → Synthetic Client Site",
                distance: 0,
                mileageDate: "July 23, 2026",
                tenantId: validExpenseReportResponse.tenantId,
            }),
        ).toThrow();
    });

    void test("rejects mileage dates after the clock's current date", () => {
        const schema = createMileageEntryInboundRequestSchema(
            () => new Date("2026-07-25T12:00:00.000Z"),
        );

        expect(() =>
            schema.parse({
                route: "Synthetic Office → Synthetic Client Site",
                distance: 12.5,
                mileageDate: "2026-07-26",
            }),
        ).toThrow("Mileage date cannot be in the future.");
        expect(
            schema.parse({
                route: "Synthetic Office → Synthetic Client Site",
                distance: 12.5,
                mileageDate: "2026-07-25",
            }).mileageDate,
        ).toBe("2026-07-25");
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

void describe("ClearExpenseReportFlagsInboundRequestSchema", () => {
    void test("requires reviewed source ids for a flag clear request", () => {
        expect(() =>
            ClearExpenseReportFlagsInboundRequestSchema.parse({
                reason: "reviewed receipt detail",
            }),
        ).toThrow();

        expect(
            ClearExpenseReportFlagsInboundRequestSchema.parse({
                sourceIds: ["30000000-0000-4000-8000-000000000201"],
                reason: "reviewed receipt detail",
            }),
        ).toStrictEqual({
            sourceIds: ["30000000-0000-4000-8000-000000000201"],
            reason: "reviewed receipt detail",
        });
    });
});

void describe("ApprovalQueueLineItemOutboundResponseSchema", () => {
    const response = {
        id: "30000000-0000-4000-8000-000000000201",
        sourceType: "line_item",
        expenseReportId: "40000000-0000-4000-8000-000000000201",
        employee: "50000000-0000-4000-8000-000000000201",
        merchant: "Synthetic Lodging",
        amount: 725,
        glCode: "6000",
        currentStage: "Manager Approval",
        flaggedLineItem: false,
        policyChecks: [
            {
                code: "line_item_over_threshold",
                message: "Amount requires manual review.",
                state: "cleared",
            },
        ],
        reviewAction: null,
        deductible: false,
        canAdvance: false,
        reportTotalMileage: 0,
        mileageEntries: [],
        receipts: [],
    };

    void test("parses durable cleared policy-check metadata", () => {
        expect(
            ApprovalQueueLineItemOutboundResponseSchema.parse(response),
        ).toStrictEqual(response);
    });

    void test("requires policy-check metadata in the BFF response", () => {
        const missingPolicyChecks = {
            ...response,
            policyChecks: undefined,
        };

        expect(() =>
            ApprovalQueueLineItemOutboundResponseSchema.parse(
                missingPolicyChecks,
            ),
        ).toThrow();
    });

    void test("parses receipt metadata without exposing blob storage details", () => {
        const parsed: ApprovalQueueLineItemResponse =
            ApprovalQueueLineItemOutboundResponseSchema.parse({
                ...response,
                id: "72000000-0000-4000-8000-000000000001",
                expenseReportId: "71000000-0000-4000-8000-000000000001",
                employee: "50000000-0000-4000-8000-000000000001",
                merchant: "Synthetic Hotel",
                amount: 125.5,
                receipts: [
                    {
                        id: "81000000-0000-4000-8000-000000000001",
                        lineItemId: "72000000-0000-4000-8000-000000000001",
                        merchant: "Synthetic Hotel",
                        receiptDate: "2026-07-21",
                        amount: 125.5,
                        filename: "synthetic-hotel.pdf",
                        contentType: "application/pdf",
                    },
                ],
                blobReference: { objectKey: "tenant/report/receipt" },
            });

        expect(parsed.receipts[0]).toStrictEqual({
            id: "81000000-0000-4000-8000-000000000001",
            lineItemId: "72000000-0000-4000-8000-000000000001",
            merchant: "Synthetic Hotel",
            receiptDate: "2026-07-21",
            amount: 125.5,
            filename: "synthetic-hotel.pdf",
            contentType: "application/pdf",
        });
        expect("blobReference" in parsed).toBe(false);
    });
});
void describe("AuditEntryOutboundResponseSchema", () => {
    void test("parses the redacted outbound audit event shape", () => {
        const parsed: AuditEntryResponse =
            AuditEntryOutboundResponseSchema.parse(validAuditEntryResponse);

        expect(parsed).toStrictEqual(validAuditEntryResponse);
    });

    void test("parses an audit entry list for the Audit Trail view", () => {
        const parsed = AuditEntryListOutboundResponseSchema.parse([
            validAuditEntryResponse,
        ]);

        expect(parsed).toStrictEqual([validAuditEntryResponse]);
    });

    void test("rejects audit responses with arbitrary payment metadata", () => {
        const parsed = AuditEntryOutboundResponseSchema.parse({
            ...validAuditEntryResponse,
            paymentReference: "synthetic-payment-reference",
            rawRequestBody: { amount: "15.00" },
        });

        expect(parsed).not.toHaveProperty("paymentReference");
        expect(parsed).not.toHaveProperty("rawRequestBody");
    });
});

void describe("CaseComment schemas", () => {
    void test("parses case comment responses", () => {
        const parsed: CaseCommentResponse =
            CaseCommentOutboundResponseSchema.parse(validCaseCommentResponse);

        expect(parsed).toStrictEqual(validCaseCommentResponse);
    });

    void test("parses comment lists", () => {
        expect(
            CaseCommentListOutboundResponseSchema.parse([
                validCaseCommentResponse,
            ]),
        ).toStrictEqual([validCaseCommentResponse]);
    });

    void test("trims and validates create comment requests", () => {
        const parsed: CreateCaseCommentRequest =
            CreateCaseCommentInboundRequestSchema.parse({
                body: "  Synthetic dispute note.  ",
            });

        expect(parsed).toStrictEqual({ body: "Synthetic dispute note." });
        expect(() =>
            CreateCaseCommentInboundRequestSchema.parse({ body: "   " }),
        ).toThrow();
        expect(() =>
            CreateCaseCommentInboundRequestSchema.parse({
                body: "Synthetic dispute note.",
                tenantId: validExpenseReportResponse.tenantId,
            }),
        ).toThrow();
    });
});
