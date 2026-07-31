import {
    extendZodWithOpenApi,
    OpenApiGeneratorV31,
    OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import { z } from "zod";

import {
    AddDraftExpenseContentInboundRequestSchema,
    AddDraftExpenseContentOutboundResponseSchema,
    ApprovalQueueLineItemListOutboundResponseSchema,
    ApprovalQueueLineItemOutboundResponseSchema,
    AuditEntryListOutboundResponseSchema,
    AllTransactionPageSchema,
    CaseQueueStageRollupListSchema,
    ClearExpenseReportFlagsInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    CreateMileageEntryInboundRequestSchema,
    DraftExpenseContentOutboundResponseSchema,
    ExpenseReportOutboundResponseSchema,
    ExpenseReportReviewDetailSchema,
    FinanceDashboardTrendPointListSchema,
    MileageConfigOutboundResponseSchema,
    MileageEntryOutboundResponseSchema,
    MySubmissionDetailSchema,
    MySubmissionPageSchema,
    ReadAllTransactionsQuerySchema,
    ReadCaseQueueStageRollupsQuerySchema,
    ReadFinanceDashboardTrendQuerySchema,
    ReadMySubmissionsQuerySchema,
    ReceiptUploadMetadataInboundRequestSchema,
    ReceiptUploadOutboundResponseSchema,
    ReviewExpenseReportLineItemInboundRequestSchema,
    ReviewExpenseReportLineItemParamsSchema,
    ReviewExpenseReportSourceParamsSchema,
    SettleExpenseReportInboundRequestSchema,
    SubmitExpenseReportInboundRequestSchema,
    TransitionExpenseReportWorkflowInboundRequestSchema,
    UpdateExpenseReportSourceDeductibilityInboundRequestSchema,
    UpdateDraftLineItemInboundRequestSchema,
} from "../schemas/expense-report.schema.js";
import {
    loginRequestSchema,
    loginResponseSchema,
} from "../auth/login/loginService.js";
import { loginErrorResponseSchema } from "../auth/login/loginController.js";
import {
    mfaEnrollmentRequestSchema,
    mfaEnrollmentResponseSchema,
} from "../auth/mfa/mfaEnrollmentService.js";

extendZodWithOpenApi(z);

const problemJsonSchema = z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string(),
});

const expenseReportIdPathParamsSchema = z.object({
    id: z.uuid(),
});
const expenseReportSourcePathParamsSchema = z.object({
    id: z.uuid(),
    sourceId: z.uuid(),
});

/**
 * Generates the Core Case Service OpenAPI contract from shared Zod DTO schemas.
 */
export function generateCoreCaseServiceOpenApiDocument(): OpenAPIObject {
    const registry = new OpenAPIRegistry();
    registry.registerComponent("securitySchemes", "bearerAuth", {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
    });
    const createExpenseReportRequest = registry.register(
        "CreateExpenseReportRequest",
        CreateExpenseReportInboundRequestSchema,
    );
    const expenseReportResponse = registry.register(
        "ExpenseReportResponse",
        ExpenseReportOutboundResponseSchema,
    );
    const expenseReportReviewDetailResponse = registry.register(
        "ExpenseReportReviewDetailResponse",
        ExpenseReportReviewDetailSchema,
    );
    const createMileageEntryRequest = registry.register(
        "CreateMileageEntryRequest",
        CreateMileageEntryInboundRequestSchema,
    );
    const addDraftExpenseContentRequest = registry.register(
        "AddDraftExpenseContentRequest",
        AddDraftExpenseContentInboundRequestSchema,
    );
    const addDraftExpenseContentResponse = registry.register(
        "AddDraftExpenseContentResponse",
        AddDraftExpenseContentOutboundResponseSchema,
    );
    const draftExpenseContentResponse = registry.register(
        "DraftExpenseContentResponse",
        DraftExpenseContentOutboundResponseSchema,
    );
    const updateDraftLineItemRequest = registry.register(
        "UpdateDraftLineItemRequest",
        UpdateDraftLineItemInboundRequestSchema,
    );
    const mileageEntryResponse = registry.register(
        "MileageEntryResponse",
        MileageEntryOutboundResponseSchema,
    );
    const mileageConfigResponse = registry.register(
        "MileageConfigResponse",
        MileageConfigOutboundResponseSchema,
    );
    const receiptUploadMetadataRequest = registry.register(
        "ReceiptUploadMetadataRequest",
        ReceiptUploadMetadataInboundRequestSchema,
    );
    const receiptUploadResponse = registry.register(
        "ReceiptUploadResponse",
        ReceiptUploadOutboundResponseSchema,
    );
    const submitExpenseReportRequest = registry.register(
        "SubmitExpenseReportRequest",
        SubmitExpenseReportInboundRequestSchema,
    );
    const transitionExpenseReportWorkflowRequest = registry.register(
        "TransitionExpenseReportWorkflowRequest",
        TransitionExpenseReportWorkflowInboundRequestSchema,
    );
    const settleExpenseReportRequest = registry.register(
        "SettleExpenseReportRequest",
        SettleExpenseReportInboundRequestSchema,
    );
    const reviewExpenseReportLineItemRequest = registry.register(
        "ReviewExpenseReportLineItemRequest",
        ReviewExpenseReportLineItemInboundRequestSchema,
    );
    const reviewExpenseReportLineItemParams = registry.register(
        "ReviewExpenseReportLineItemParams",
        ReviewExpenseReportLineItemParamsSchema,
    );
    const reviewExpenseReportSourceParams = registry.register(
        "ReviewExpenseReportSourceParams",
        ReviewExpenseReportSourceParamsSchema,
    );
    const updateExpenseReportSourceDeductibilityRequest = registry.register(
        "UpdateExpenseReportSourceDeductibilityRequest",
        UpdateExpenseReportSourceDeductibilityInboundRequestSchema,
    );
    const approvalQueueLineItemResponse = registry.register(
        "ApprovalQueueLineItemResponse",
        ApprovalQueueLineItemOutboundResponseSchema,
    );
    const approvalQueueLineItemListResponse = registry.register(
        "ApprovalQueueLineItemListResponse",
        ApprovalQueueLineItemListOutboundResponseSchema,
    );
    const clearExpenseReportFlagsRequest = registry.register(
        "ClearExpenseReportFlagsRequest",
        ClearExpenseReportFlagsInboundRequestSchema,
    );
    const clearExpenseReportFlagsResponse = registry.register(
        "ClearExpenseReportFlagsResponse",
        z.object({ clearedFlagCount: z.number().int().nonnegative() }),
    );
    const readCaseQueueStageRollupsRequest = registry.register(
        "ReadCaseQueueStageRollupsRequest",
        ReadCaseQueueStageRollupsQuerySchema,
    );
    const caseQueueStageRollupList = registry.register(
        "CaseQueueStageRollupList",
        CaseQueueStageRollupListSchema,
    );
    const readFinanceDashboardTrendRequest = registry.register(
        "ReadFinanceDashboardTrendRequest",
        ReadFinanceDashboardTrendQuerySchema,
    );
    const financeDashboardTrendPointList = registry.register(
        "FinanceDashboardTrendPointList",
        FinanceDashboardTrendPointListSchema,
    );
    const mySubmissionPage = registry.register(
        "MySubmissionPage",
        MySubmissionPageSchema,
    );
    const readMySubmissionsQuery = registry.register(
        "ReadMySubmissionsQuery",
        ReadMySubmissionsQuerySchema,
    );
    const mySubmissionDetail = registry.register(
        "MySubmissionDetail",
        MySubmissionDetailSchema,
    );
    const auditEntryListResponse = registry.register(
        "AuditEntryListResponse",
        AuditEntryListOutboundResponseSchema,
    );
    const readAllTransactionsRequest = registry.register(
        "ReadAllTransactionsRequest",
        ReadAllTransactionsQuerySchema,
    );
    const allTransactionPage = registry.register(
        "AllTransactionPage",
        AllTransactionPageSchema,
    );
    const mfaEnrollmentRequest = registry.register(
        "MfaEnrollmentRequest",
        mfaEnrollmentRequestSchema,
    );
    const mfaEnrollmentResponse = registry.register(
        "MfaEnrollmentResponse",
        mfaEnrollmentResponseSchema,
    );
    const problemJson = registry.register("ProblemJson", problemJsonSchema);
    const rateLimitLimitHeader = registry.registerComponent(
        "headers",
        "RateLimitLimit",
        integerHeader("Maximum tenant requests in the current window.", 1),
    );
    const rateLimitRemainingHeader = registry.registerComponent(
        "headers",
        "RateLimitRemaining",
        integerHeader("Tenant requests remaining in the current window.", 0),
    );
    const rateLimitResetHeader = registry.registerComponent(
        "headers",
        "RateLimitReset",
        integerHeader("Seconds until the current tenant window resets.", 1),
    );
    const rateLimitCostHeader = registry.registerComponent(
        "headers",
        "RateLimitCost",
        integerHeader("Request units charged for this API call.", 1),
    );
    const retryAfterHeader = registry.registerComponent(
        "headers",
        "RetryAfter",
        integerHeader("Seconds until the tenant may retry the request.", 1),
    );
    const rateLimitHeaders = {
        "RateLimit-Limit": rateLimitLimitHeader.ref,
        "RateLimit-Remaining": rateLimitRemainingHeader.ref,
        "RateLimit-Reset": rateLimitResetHeader.ref,
        "X-RateLimit-Cost": rateLimitCostHeader.ref,
    };
    const rateLimitExceededResponse = registry.registerComponent(
        "responses",
        "RateLimitExceeded",
        {
            description: "The authenticated tenant request limit was exceeded.",
            headers: {
                ...rateLimitHeaders,
                "Retry-After": retryAfterHeader.ref,
            },
            content: {
                "application/problem+json": {
                    schema: { $ref: "#/components/schemas/ProblemJson" },
                },
            },
        },
    );
    const loginRequest = registry.register("LoginRequest", loginRequestSchema);
    const loginResponse = registry.register(
        "LoginResponse",
        loginResponseSchema,
    );
    const loginErrorResponse = registry.register(
        "LoginErrorResponse",
        loginErrorResponseSchema,
    );

    registry.registerPath({
        method: "put",
        path: "/v1/expense-reports/{id}/receipt-uploads/{uploadId}",
        summary: "Upload a receipt to a Drafted Expense Report",
        description:
            "Stores receipt bytes for the authenticated Employee's own Drafted Expense Report before its metadata is attached to a line item.",
        security: [{ bearerAuth: [] }],
        request: {
            params: z.object({
                id: z.uuid(),
                uploadId: z.uuid(),
            }),
            query: receiptUploadMetadataRequest.pick({ filename: true }),
            body: {
                required: true,
                content: {
                    "application/pdf": {
                        schema: z.string().openapi({ format: "binary" }),
                    },
                    "image/png": {
                        schema: z.string().openapi({ format: "binary" }),
                    },
                    "image/jpeg": {
                        schema: z.string().openapi({ format: "binary" }),
                    },
                    "image/webp": {
                        schema: z.string().openapi({ format: "binary" }),
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Receipt uploaded.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: receiptUploadResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed receipt upload."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            404: problemJsonResponse("Drafted Expense Report not found."),
            413: problemJsonResponse("Receipt exceeds 10 MB."),
            429: rateLimitExceededResponse.ref,
            502: problemJsonResponse("Receipt storage rejected the upload."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/draft-content",
        summary: "Add line items and receipt references to a draft",
        description:
            "Atomically adds validated line items and receipt references to the authenticated Employee's own Drafted Expense Report.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            headers: z.object({
                "Idempotency-Key": z.string().max(128),
            }),
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: addDraftExpenseContentRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Draft expense content added.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: addDraftExpenseContentResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed draft content request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            404: problemJsonResponse("Drafted Expense Report not found."),
            409: problemJsonResponse(
                "Expense content can only be added while the report is Drafted.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/{id}/draft-content",
        summary: "Get saved content from a draft",
        description:
            "Returns saved line items, receipt metadata, and mileage entries from the authenticated Employee's own Drafted Expense Report.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
        },
        responses: {
            200: {
                description: "Draft expense content found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: draftExpenseContentResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            404: problemJsonResponse("Drafted Expense Report not found."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    for (const source of [
        {
            path: "/v1/expense-reports/{id}/line-items/{sourceId}",
            label: "line item",
            updateSchema: updateDraftLineItemRequest,
        },
        {
            path: "/v1/expense-reports/{id}/mileage-entries/{sourceId}",
            label: "mileage entry",
            updateSchema: createMileageEntryRequest,
        },
    ] as const) {
        registry.registerPath({
            method: "patch",
            path: source.path,
            summary: `Update a saved draft ${source.label}`,
            description: `Updates one ${source.label} in the authenticated Employee's own Drafted Expense Report.`,
            security: [{ bearerAuth: [] }],
            request: {
                params: expenseReportSourcePathParamsSchema,
                body: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: source.updateSchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Updated draft content.",
                    headers: rateLimitHeaders,
                    content: {
                        "application/json": {
                            schema: draftExpenseContentResponse,
                        },
                    },
                },
                400: problemJsonResponse("Malformed draft update."),
                401: problemJsonResponse("Valid access token required."),
                403: problemJsonResponse("Employee Portal access required."),
                404: problemJsonResponse("Draft expense entry not found."),
                409: problemJsonResponse(
                    "Expense entries can only be changed while Drafted.",
                ),
                429: rateLimitExceededResponse.ref,
            },
        });
        registry.registerPath({
            method: "delete",
            path: source.path,
            summary: `Delete a saved draft ${source.label}`,
            description: `Deletes one ${source.label} from the authenticated Employee's own Drafted Expense Report.`,
            security: [{ bearerAuth: [] }],
            request: {
                params: expenseReportSourcePathParamsSchema,
            },
            responses: {
                200: {
                    description: "Updated draft content.",
                    headers: rateLimitHeaders,
                    content: {
                        "application/json": {
                            schema: draftExpenseContentResponse,
                        },
                    },
                },
                401: problemJsonResponse("Valid access token required."),
                403: problemJsonResponse("Employee Portal access required."),
                404: problemJsonResponse("Draft expense entry not found."),
                409: problemJsonResponse(
                    "Expense entries can only be changed while Drafted.",
                ),
                429: rateLimitExceededResponse.ref,
            },
        });
    }

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/my-submissions",
        summary: "Get the employee's Expense Reports",
        description:
            "Returns only Expense Reports owned by the authenticated Employee within the authenticated tenant, including workflow position and overdue state.",
        security: [{ bearerAuth: [] }],
        request: {
            query: readMySubmissionsQuery,
        },
        responses: {
            200: {
                description: "Employee submissions found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: mySubmissionPage,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/{id}/submission-detail",
        summary: "Get an employee submission's line items and mileage",
        description:
            "Returns line items and mileage only when the Expense Report belongs to the authenticated Employee within the authenticated tenant.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
        },
        responses: {
            200: {
                description: "Employee submission detail found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: mySubmissionDetail,
                    },
                },
            },
            400: problemJsonResponse("Malformed Expense Report identifier."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            404: problemJsonResponse("Expense Report not found."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/case-queue/line-items",
        summary: "List Approval Queue line items",
        description:
            "Loads latest-submission line items waiting for manager review within the authenticated tenant.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Approval Queue line items found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: approvalQueueLineItemListResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse(
                "Case Queue access is limited to internal roles.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/case-queue/rollups",
        summary: "Get Case Queue rollups",
        description:
            "Loads Case Queue rollups for the authenticated tenant from the Redis cache or DynamoDB source of record.",
        security: [{ bearerAuth: [] }],
        request: {
            query: readCaseQueueStageRollupsRequest,
        },
        responses: {
            200: {
                description: "Case Queue rollups found.",
                content: {
                    "application/json": {
                        schema: caseQueueStageRollupList,
                    },
                },
            },
            400: problemJsonResponse("Malformed rollup request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse("Authenticated user is not permitted."),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/finance-dashboard/trends",
        summary: "Get Finance Dashboard report trends",
        description:
            "Loads Finance Admin-only tenant-scoped daily UTC Expense Report creation volume and spend grouped by currency for the Finance Dashboard. Requests may span at most 31 days.",
        security: [{ bearerAuth: [] }],
        request: {
            query: readFinanceDashboardTrendRequest,
        },
        responses: {
            200: {
                description: "Finance Dashboard trend points found.",
                content: {
                    "application/json": {
                        schema: financeDashboardTrendPointList,
                    },
                },
            },
            400: problemJsonResponse(
                "Malformed Finance Dashboard trend request.",
            ),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Finance Dashboard access is limited to Finance Admins.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/transactions",
        summary: "Get All Transactions",
        description:
            "Loads tenant-scoped line items across Expense Reports for Finance Admin review.",
        security: [{ bearerAuth: [] }],
        request: {
            query: readAllTransactionsRequest,
        },
        responses: {
            200: {
                description: "All Transactions rows found.",
                content: {
                    "application/json": {
                        schema: allTransactionPage,
                    },
                },
            },
            400: problemJsonResponse("Malformed transaction list request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse("Authenticated user is not permitted."),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/auth/login",
        summary: "Authenticate with email, password, and optional TOTP MFA",
        description:
            "Issues a short-lived access JWT and a signed refresh JWT after successful tenant-scoped authentication.",
        request: {
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: loginRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Login succeeded and tokens were issued.",
                content: {
                    "application/json": {
                        schema: loginResponse,
                    },
                },
            },
            401: {
                description:
                    "Invalid credentials, MFA required, or invalid MFA code.",
                content: {
                    "application/json": {
                        schema: loginErrorResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed login request."),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/auth/mfa/enroll",
        summary: "Enroll TOTP MFA",
        description:
            "Provisions a TOTP secret for a tenant user and returns an authenticator-app provisioning URI.",
        request: {
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: mfaEnrollmentRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "TOTP MFA enrollment created.",
                content: {
                    "application/json": {
                        schema: mfaEnrollmentResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed MFA enrollment request."),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports",
        summary: "Create an Expense Report",
        description:
            "Creates an Expense Report case in Drafted stage and records the initial audit and stage-transition entries within the authenticated tenant.",
        security: [{ bearerAuth: [] }],
        request: {
            headers: z.object({
                "Idempotency-Key": z.string().max(128).openapi({
                    description:
                        "Required tenant-scoped key used to replay completed Expense Report submissions.",
                }),
            }),
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: createExpenseReportRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Expense Report created.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed create request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            409: problemJsonResponse(
                "Submission with this idempotency key is already in progress.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/drafts/current",
        summary: "Get the employee's current Drafted Expense Report",
        description:
            "Loads the most recently updated Drafted Expense Report owned by the authenticated Employee.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Current Drafted Expense Report found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            404: problemJsonResponse("No Drafted Expense Report found."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/config/mileage",
        summary: "Get the configured mileage reimbursement rate",
        description:
            "Returns the server-configured per-mile reimbursement policy used by the Employee Mileage Tracker.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Mileage reimbursement configuration found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: mileageConfigResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/mileage-entries",
        summary: "Add mileage to a Drafted Expense Report",
        description:
            "Adds a validated mileage entry to an authenticated Employee's own Drafted Expense Report.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            headers: z.object({
                "Idempotency-Key": z.string().max(128),
            }),
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: createMileageEntryRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Mileage entry added.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: mileageEntryResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed mileage request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Employee Portal access required."),
            404: problemJsonResponse("Drafted Expense Report not found."),
            409: problemJsonResponse(
                "Mileage can only be added while the Expense Report is Drafted.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/{id}/review-detail",
        summary: "Get complete Expense Report review detail",
        description:
            "Loads all line-item and mileage sources for a Finance Admin report-detail surface independent of All Transactions filters or pagination.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
        },
        responses: {
            200: {
                description: "Expense Report review detail found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: expenseReportReviewDetailResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Finance Admin access required."),
            404: problemJsonResponse("Expense Report not found."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/{id}",
        summary: "Get an Expense Report",
        description:
            "Loads an Expense Report case by identifier within the authenticated tenant.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
        },
        responses: {
            200: {
                description: "Expense Report found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),

            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/submit",
        summary: "Submit an Expense Report",
        description:
            "Advances an Employee-owned Drafted Expense Report to Submitted after GL-coding line items and mileage with a tenant-scoped service JWT.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            headers: z.object({
                "Idempotency-Key": z.string().max(128).openapi({
                    description:
                        "Required tenant-scoped key used to replay completed Expense Report submissions.",
                }),
                "x-correlation-id": z.uuid().optional().openapi({
                    description:
                        "End-to-end request correlation identifier. The service generates one when omitted.",
                }),
            }),
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: submitExpenseReportRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Expense Report submitted.",
                headers: {
                    ...rateLimitHeaders,
                    "X-Correlation-Id": {
                        description:
                            "Correlation identifier carried by the published stage-transition event.",
                        schema: {
                            type: "string",
                            format: "uuid",
                        },
                    },
                },
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed submit request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            409: problemJsonResponse(
                "Only Drafted Expense Reports can be submitted.",
            ),
            429: rateLimitExceededResponse.ref,
            502: problemJsonResponse("GL-coding service request failed."),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/transitions",
        summary: "Transition an Expense Report",
        description:
            "Applies role, current-stage, and Manager Approval flag guards before advancing or sending an Expense Report back to Drafted.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            headers: z.object({
                "x-correlation-id": z.uuid().optional().openapi({
                    description:
                        "End-to-end request correlation identifier. The service generates one when omitted.",
                }),
            }),
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: transitionExpenseReportWorkflowRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report transitioned.",
                headers: {
                    ...rateLimitHeaders,
                    "X-Correlation-Id": {
                        description:
                            "Correlation identifier carried by the published stage-transition event.",
                        schema: {
                            type: "string",
                            format: "uuid",
                        },
                    },
                },
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed transition request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            409: problemJsonResponse(
                "Expense Report cannot transition from its current stage or has uncleared flags.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/settlement",
        summary: "Settle an Expense Report",
        description:
            "Coordinates the Issue Payment stub, Paid transition, and Reconciled transition as a compensating settlement saga.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            headers: z.object({
                "Idempotency-Key": z.string().max(128).openapi({
                    description:
                        "Required tenant-scoped key used to replay completed Expense Report settlements.",
                }),
                "x-correlation-id": z.uuid().optional().openapi({
                    description:
                        "End-to-end request correlation identifier. The service generates one when omitted.",
                }),
            }),
            body: {
                required: false,
                content: {
                    "application/json": {
                        schema: settleExpenseReportRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report settled and reconciled.",
                headers: {
                    ...rateLimitHeaders,
                    "X-Correlation-Id": {
                        description:
                            "Correlation identifier carried by settlement saga events.",
                        schema: {
                            type: "string",
                            format: "uuid",
                        },
                    },
                },
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed settlement request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            409: problemJsonResponse(
                "Settlement can only start from AP Review and must complete its compensated saga.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/line-items/{sourceId}/review",
        summary: "Review an Expense Report line item",
        description:
            "Records a manager approve or reject decision for one latest-submission line item during Manager Approval.",
        security: [{ bearerAuth: [] }],
        request: {
            params: reviewExpenseReportLineItemParams,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: reviewExpenseReportLineItemRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Line item reviewed.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: approvalQueueLineItemResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed line-item review request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report line item not found."),
            409: problemJsonResponse(
                "Line items can only be reviewed during Manager Approval.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review",
        summary: "Review an Expense Report source",
        description:
            "Records a manager approve or reject decision for one latest-submission line item or mileage source during Manager Approval.",
        security: [{ bearerAuth: [] }],
        request: {
            params: reviewExpenseReportSourceParams,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: reviewExpenseReportLineItemRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report source reviewed.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: approvalQueueLineItemResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed source review request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report source not found."),
            409: problemJsonResponse(
                "Expense Report sources can only be reviewed during Manager Approval.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "patch",
        path: "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/deductibility",
        summary: "Update Expense Report source deductibility",
        description:
            "Records a manual deductibility flag for one latest-submission line item or mileage source during AP Review. No auto-classification is performed.",
        security: [{ bearerAuth: [] }],
        request: {
            params: reviewExpenseReportSourceParams,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: updateExpenseReportSourceDeductibilityRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report source deductibility updated.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: approvalQueueLineItemResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed deductibility request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report source not found."),
            409: problemJsonResponse(
                "Deductibility can only be updated during AP Review.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });
    registry.registerPath({
        method: "post",
        path: "/v1/expense-reports/{id}/flags/clear",
        summary: "Clear reviewed Expense Report flags",
        description:
            "Clears reviewed over-threshold line-item flags so Manager Approval can advance after the final flag is cleared.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: clearExpenseReportFlagsRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report flags cleared.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: clearExpenseReportFlagsResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed flag-clear request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            409: problemJsonResponse(
                "Line-item flags can only be cleared during Manager Approval.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });
    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/{id}/audit-entries",
        summary: "List Expense Report audit entries",
        description:
            "Loads append-only audit entries for the Expense Report Audit Trail view within the authenticated tenant.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
        },
        responses: {
            200: {
                description: "Audit entries found for the Expense Report.",
                content: {
                    "application/json": {
                        schema: auditEntryListResponse,
                    },
                },
            },
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    const generator = new OpenApiGeneratorV31(registry.definitions, {
        sortComponents: "alphabetically",
    });

    return generator.generateDocument({
        openapi: "3.1.0",
        info: {
            title: "ExpenseFlow Core Case Service API v1",
            version: "1.0.0",
            description:
                "Version 1 contract for Core Case Service endpoints. Fields are never removed or changed silently within v1: a field is first marked deprecated with a migration note and remains supported until a future API version. Per-tenant rate limits apply to bearer-authenticated routes; pre-authentication endpoints require separate abuse controls because submitted tenant identifiers are not trusted.",
        },
        servers: [
            {
                url: "http://localhost:3000",
                description: "Local development server",
            },
        ],
    });

    function problemJsonResponse(description: string) {
        return {
            description,
            content: {
                "application/problem+json": {
                    schema: problemJson,
                },
            },
        };
    }

    function integerHeader(description: string, minimum: number) {
        return {
            description,
            schema: { type: "integer" as const, minimum },
        };
    }
}

export const coreCaseServiceOpenApiDocument =
    generateCoreCaseServiceOpenApiDocument();
