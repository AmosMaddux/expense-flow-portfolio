import {
    extendZodWithOpenApi,
    OpenApiGeneratorV31,
    OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import { z } from "zod";

import {
    CaseQueueStageRollupListSchema,
    AuditEntryListOutboundResponseSchema,
    ClearExpenseReportFlagsInboundRequestSchema,
    CreateExpenseReportInboundRequestSchema,
    CreateMileageEntryInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    MileageConfigOutboundResponseSchema,
    MileageEntryOutboundResponseSchema,
    ReadCaseQueueStageRollupsQuerySchema,
    SubmitExpenseReportInboundRequestSchema,
    TransitionExpenseReportWorkflowInboundRequestSchema,
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
    const createMileageEntryRequest = registry.register(
        "CreateMileageEntryRequest",
        CreateMileageEntryInboundRequestSchema,
    );
    const mileageEntryResponse = registry.register(
        "MileageEntryResponse",
        MileageEntryOutboundResponseSchema,
    );
    const mileageConfigResponse = registry.register(
        "MileageConfigResponse",
        MileageConfigOutboundResponseSchema,
    );
    const submitExpenseReportRequest = registry.register(
        "SubmitExpenseReportRequest",
        SubmitExpenseReportInboundRequestSchema,
    );
    const transitionExpenseReportWorkflowRequest = registry.register(
        "TransitionExpenseReportWorkflowRequest",
        TransitionExpenseReportWorkflowInboundRequestSchema,
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
    const auditEntryListResponse = registry.register(
        "AuditEntryListResponse",
        AuditEntryListOutboundResponseSchema,
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
            "Advances a Drafted Expense Report to Submitted after GL-coding line items and mileage with a tenant-scoped service JWT.",
        security: [{ bearerAuth: [] }],
        request: {
            params: expenseReportIdPathParamsSchema,
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
                        schema: submitExpenseReportRequest,
                    },
                },
            },
        },
        responses: {
            201: {
                description: "Expense Report submitted.",
                headers: rateLimitHeaders,
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
                headers: rateLimitHeaders,
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
