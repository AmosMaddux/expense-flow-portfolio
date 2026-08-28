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
    CaseCommentListOutboundResponseSchema,
    CaseCommentOutboundResponseSchema,
    CaseQueueStageRollupListSchema,
    ClearExpenseReportFlagsInboundRequestSchema,
    CreateCaseCommentInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    CreateMileageEntryInboundRequestSchema,
    DraftExpenseContentOutboundResponseSchema,
    ExpenseReportOutboundResponseSchema,
    ExpenseReportReviewDetailSchema,
    ExpenseReportSummaryPageSchema,
    FinanceDashboardTrendPointListSchema,
    InternalSettlePaymentStubBodySchema,
    InternalSettlePaymentStubHeadersSchema,
    InternalSettlePaymentStubParamsSchema,
    MileageConfigOutboundResponseSchema,
    MileageEntryOutboundResponseSchema,
    MySubmissionDetailSchema,
    MySubmissionPageSchema,
    PolicyReferenceOutboundResponseSchema,
    ReadAllTransactionsQuerySchema,
    ReadCaseQueueStageRollupsQuerySchema,
    ReadFinanceDashboardTrendQuerySchema,
    ReadExpenseReportSummariesQuerySchema,
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
    GlMappingReferenceOutboundResponseSchema,
    SaveGlMappingsInboundRequestSchema,
} from "../glMappings/glMappingDto.js";
import {
    InviteTeamUserInboundRequestSchema,
    TeamUserOutboundResponseSchema,
    TeamUserPathParamsSchema,
    TeamUsersListOutboundResponseSchema,
    UpdateTeamUserRoleInboundRequestSchema,
    UpdateTeamUserStatusInboundRequestSchema,
} from "../teamUsers/teamUsersDto.js";
import {
    RolePermissionMatrixOutboundResponseSchema,
    TenantSummaryListOutboundResponseSchema,
} from "../platformAdmin/platformAdminDto.js";
import { loginRequestSchema } from "../auth/login/loginService.js";
import { TokenOutboundResponseSchema } from "../auth/refresh/refreshService.js";
import { loginErrorResponseSchema } from "../auth/login/loginController.js";
import {
    AssistInboundRequestSchema,
    AssistOutboundResponseSchema,
} from "../policyReference/assistService.js";
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
    const expenseReportSummaryPage = registry.register(
        "ExpenseReportSummaryPage",
        ExpenseReportSummaryPageSchema,
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
    const assistRequest = registry.register(
        "AssistRequest",
        AssistInboundRequestSchema,
    );
    const assistResponse = registry.register(
        "AssistResponse",
        AssistOutboundResponseSchema,
    );
    const policyReferenceResponse = registry.register(
        "PolicyReferenceResponse",
        PolicyReferenceOutboundResponseSchema,
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
    const internalSettlePaymentStubRequest = registry.register(
        "InternalSettlePaymentStubRequest",
        InternalSettlePaymentStubBodySchema,
    );
    const internalSettlePaymentStubHeaders = registry.register(
        "InternalSettlePaymentStubHeaders",
        InternalSettlePaymentStubHeadersSchema,
    );
    const internalSettlePaymentStubParams = registry.register(
        "InternalSettlePaymentStubParams",
        InternalSettlePaymentStubParamsSchema,
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
    const caseCommentResponse = registry.register(
        "CaseCommentResponse",
        CaseCommentOutboundResponseSchema,
    );
    const caseCommentListResponse = registry.register(
        "CaseCommentListResponse",
        CaseCommentListOutboundResponseSchema,
    );
    const createCaseCommentRequest = registry.register(
        "CreateCaseCommentRequest",
        CreateCaseCommentInboundRequestSchema,
    );
    const readAllTransactionsRequest = registry.register(
        "ReadAllTransactionsRequest",
        ReadAllTransactionsQuerySchema,
    );
    const readExpenseReportSummariesRequest = registry.register(
        "ReadExpenseReportSummariesRequest",
        ReadExpenseReportSummariesQuerySchema,
    );
    const allTransactionPage = registry.register(
        "AllTransactionPage",
        AllTransactionPageSchema,
    );
    const glMappingReferenceResponse = registry.register(
        "GlMappingReferenceResponse",
        GlMappingReferenceOutboundResponseSchema,
    );
    const saveGlMappingsRequest = registry.register(
        "SaveGlMappingsRequest",
        SaveGlMappingsInboundRequestSchema,
    );
    const teamUsersListResponse = registry.register(
        "TeamUsersListResponse",
        TeamUsersListOutboundResponseSchema,
    );
    const teamUserResponse = registry.register(
        "TeamUserResponse",
        TeamUserOutboundResponseSchema,
    );
    const inviteTeamUserRequest = registry.register(
        "InviteTeamUserRequest",
        InviteTeamUserInboundRequestSchema,
    );
    const updateTeamUserRoleRequest = registry.register(
        "UpdateTeamUserRoleRequest",
        UpdateTeamUserRoleInboundRequestSchema,
    );
    const updateTeamUserStatusRequest = registry.register(
        "UpdateTeamUserStatusRequest",
        UpdateTeamUserStatusInboundRequestSchema,
    );
    const teamUserPathParams = registry.register(
        "TeamUserPathParams",
        TeamUserPathParamsSchema,
    );
    const rolePermissionMatrixResponse = registry.register(
        "RolePermissionMatrixResponse",
        RolePermissionMatrixOutboundResponseSchema,
    );
    const tenantSummaryListResponse = registry.register(
        "TenantSummaryListResponse",
        TenantSummaryListOutboundResponseSchema,
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
    const refreshTokenResponse = registry.register(
        "RefreshTokenResponse",
        TokenOutboundResponseSchema,
    );
    const loginRequest = registry.register("LoginRequest", loginRequestSchema);
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
        method: "post",
        path: "/v1/assist",
        summary: "Answer a cited tenant policy question",
        security: [{ bearerAuth: [] }],
        request: {
            body: {
                content: { "application/json": { schema: assistRequest } },
            },
        },
        responses: {
            200: {
                description: "Grounded policy answer.",
                headers: rateLimitHeaders,
                content: { "application/json": { schema: assistResponse } },
            },
            400: problemJsonResponse("Malformed assist request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "AI Assist access is limited to internal roles.",
            ),
            404: problemJsonResponse("Expense Report or line item not found."),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });
    registry.registerPath({
        method: "get",
        path: "/v1/policy-reference",
        summary: "Get Policy Reference",
        description:
            "Loads the authenticated tenant's read-only expense policy reference text for internal review workspaces.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Tenant expense policy found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: policyReferenceResponse,
                    },
                },
            },
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Policy Reference access is limited to internal roles.",
            ),
            404: problemJsonResponse("Expense policy not found."),
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
        method: "get",
        path: "/v1/gl-mappings",
        summary: "List GL Mapping reference data",
        description:
            "Loads tenant-scoped category account mappings from gl_mapping. Finance Admin and Department Manager use this for the GL Mapping admin screen; Employees use it to populate expense category options when submitting an expense report.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "GL Mapping reference data found.",
                content: {
                    "application/json": {
                        schema: glMappingReferenceResponse,
                    },
                },
            },
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "GL Mapping access is limited to internal roles.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "put",
        path: "/v1/gl-mappings",
        summary: "Save GL Mapping changes",
        description:
            "Allows Finance Admins to atomically create, edit, and delete tenant-owned gl_mapping rows in a single all-or-nothing save, recording a reference-data audit entry per change in the same transaction.",
        security: [{ bearerAuth: [] }],
        request: {
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: saveGlMappingsRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "GL Mapping changes saved.",
                content: {
                    "application/json": {
                        schema: glMappingReferenceResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed GL Mapping save request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "GL Mapping edits are limited to Finance Admins.",
            ),
            404: problemJsonResponse(
                "A GL Mapping referenced by the save was not found.",
            ),
            409: problemJsonResponse(
                "The save would create a duplicate GL Mapping category.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });
    registry.registerPath({
        method: "get",
        path: "/v1/users",
        summary: "List Team & Users members",
        description:
            "Loads every tenant-scoped user with their role and status for the Finance Admin workspace.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Team & Users members found.",
                content: {
                    "application/json": {
                        schema: teamUsersListResponse,
                    },
                },
            },
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Team & Users access is limited to Finance Admins.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/users/invite",
        summary: "Invite a Team & Users member",
        description:
            "Allows Finance Admins to invite a new tenant user with an assigned role and records a reference-data audit entry in the same transaction.",
        security: [{ bearerAuth: [] }],
        request: {
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: inviteTeamUserRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Team member invited.",
                content: {
                    "application/json": {
                        schema: teamUserResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed invite request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Team & Users changes are limited to Finance Admins.",
            ),
            409: problemJsonResponse(
                "A user with this email already exists in the tenant.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "patch",
        path: "/v1/users/{id}/role",
        summary: "Change a Team & Users member's role",
        description:
            "Allows Finance Admins to replace one tenant user's assigned role and records a reference-data audit entry in the same transaction.",
        security: [{ bearerAuth: [] }],
        request: {
            params: teamUserPathParams,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: updateTeamUserRoleRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Team member role updated.",
                content: {
                    "application/json": {
                        schema: teamUserResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed role update request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Team & Users changes are limited to Finance Admins.",
            ),
            404: problemJsonResponse("Team member was not found."),
            409: problemJsonResponse(
                "Finance Admins cannot change their own role or status here.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "patch",
        path: "/v1/users/{id}/status",
        summary: "Change a Team & Users member's status",
        description:
            "Allows Finance Admins to activate or deactivate one tenant user and records a reference-data audit entry in the same transaction.",
        security: [{ bearerAuth: [] }],
        request: {
            params: teamUserPathParams,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: updateTeamUserStatusRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Team member status updated.",
                content: {
                    "application/json": {
                        schema: teamUserResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed status update request."),
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Team & Users changes are limited to Finance Admins.",
            ),
            404: problemJsonResponse("Team member was not found."),
            409: problemJsonResponse(
                "Finance Admins cannot change their own role or status here.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/platform-admin/roles-permissions",
        summary: "Read the Roles & Permissions matrix",
        description:
            "Loads the read-only role-to-screen-access matrix for the Platform Admin workspace. No control on this screen grants access to any tenant's case data.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Role-to-screen-access matrix found.",
                content: {
                    "application/json": {
                        schema: rolePermissionMatrixResponse,
                    },
                },
            },
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Platform administration is limited to Platform Admins.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/v1/platform-admin/tenants",
        summary: "List All Tenants & Users summaries",
        description:
            "Loads every tenant's user-count summary for the Platform Admin workspace. Returns aggregate counts only, never a tenant's user detail or case data.",
        security: [{ bearerAuth: [] }],
        responses: {
            200: {
                description: "Tenant user-count summaries found.",
                content: {
                    "application/json": {
                        schema: tenantSummaryListResponse,
                    },
                },
            },
            401: problemJsonResponse("Missing or invalid bearer access token."),
            403: problemJsonResponse(
                "Platform administration is limited to Platform Admins.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/auth/login",
        summary: "Authenticate with email, password, and optional TOTP MFA",
        description:
            "Issues a short-lived access JWT and sets a rotating refresh token as an HttpOnly cookie after successful tenant-scoped authentication. The refresh token is never included in the JSON response body.",
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
                description:
                    "Login succeeded. An access token was issued in the response body and a refresh token cookie was set.",
                content: {
                    "application/json": {
                        schema: refreshTokenResponse,
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
        path: "/v1/auth/refresh",
        summary: "Rotate a refresh token cookie into a fresh access token",
        description:
            "Reads the HttpOnly refresh token cookie set by login, re-checks the user's status and roles from the database, and issues a new short-lived access JWT alongside a rotated refresh token cookie.",
        responses: {
            200: {
                description: "A fresh access token was issued.",
                content: {
                    "application/json": {
                        schema: refreshTokenResponse,
                    },
                },
            },
            401: problemJsonResponse(
                "The refresh token cookie is missing, invalid, expired, revoked, or belongs to a user who is no longer active.",
            ),
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/auth/logout",
        summary: "Revoke the current refresh token",
        description:
            "Revokes the refresh token named by the HttpOnly cookie, if any, and clears the cookie. Always succeeds so the client can finish signing out.",
        responses: {
            204: {
                description: "The session was signed out.",
            },
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
        path: "/v1/expense-reports",
        summary: "List Expense Report summaries",
        description:
            "Loads a cursor-paginated page of Finance Admin Expense Report summaries with server-side filters, display category labels, and underlying category membership.",
        security: [{ bearerAuth: [] }],
        request: {
            query: readExpenseReportSummariesRequest,
        },
        responses: {
            200: {
                description: "Expense Report summary page found.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: expenseReportSummaryPage,
                    },
                },
            },
            400: problemJsonResponse("Malformed Expense Report list request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse(
                "Expense Reports access is limited to Finance Admins.",
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
        path: "/v1/expense-reports/{id}/payment-stub-settlement",
        summary: "Settle an AP Review Expense Report",
        description:
            "Lets an authenticated internal reviewer issue the MVP payment stub and complete the settlement-owned AP Review workflow.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            headers: z.object({
                "Idempotency-Key": z.string().max(128).openapi({
                    description:
                        "Required tenant-scoped key used to safely retry payment-stub settlement.",
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
                        schema: settleExpenseReportRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report payment stub settled.",
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
                "Expense Report settlement cannot start from its current stage.",
            ),
            429: rateLimitExceededResponse.ref,
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/v1/internal/expense-reports/{id}/payment-stub-settlement",
        summary: "Settle an Expense Report from the internal payment command",
        description:
            "Accepts trusted internal Issue Payment stub commands and delegates settlement, workflow transitions, audit entries, and outbox writes to Core Case.",
        request: {
            params: internalSettlePaymentStubParams,
            headers: internalSettlePaymentStubHeaders,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: internalSettlePaymentStubRequest,
                    },
                },
            },
        },
        responses: {
            200: {
                description: "Expense Report settled and reconciled.",
                headers: {
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
            400: problemJsonResponse("Malformed internal settlement command."),
            401: problemJsonResponse("Valid internal command token required."),
            403: problemJsonResponse("Command role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            409: problemJsonResponse(
                "Settlement can only start from AP Review and must complete its compensated saga.",
            ),
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
    registry.registerPath({
        method: "get",
        path: "/v1/expense-reports/{id}/comments",
        summary: "List Expense Report comments",
        description:
            "Loads tenant- and case-scoped comment thread entries for an Expense Report case.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
        },
        responses: {
            200: {
                description: "Comments found for the Expense Report.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: caseCommentListResponse,
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
        path: "/v1/expense-reports/{id}/comments",
        summary: "Create Expense Report comment",
        description:
            "Appends a tenant- and case-scoped dispute or comment entry to an Expense Report case.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
            body: {
                required: true,
                content: {
                    "application/json": {
                        schema: createCaseCommentRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Comment created for the Expense Report.",
                headers: rateLimitHeaders,
                content: {
                    "application/json": {
                        schema: caseCommentResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed comment request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
            404: problemJsonResponse("Expense Report not found."),
            429: rateLimitExceededResponse.ref,
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
