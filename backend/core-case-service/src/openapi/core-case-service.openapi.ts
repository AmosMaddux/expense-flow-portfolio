import {
    extendZodWithOpenApi,
    OpenApiGeneratorV31,
    OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import { z } from "zod";

import {
    CreateExpenseReportInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    SubmitExpenseReportInboundRequestSchema,
} from "../schemas/expense-report.schema.js";
import {
    loginRequestSchema,
    loginResponseSchema,
} from "../auth/login/loginService.js";
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
    const submitExpenseReportRequest = registry.register(
        "SubmitExpenseReportRequest",
        SubmitExpenseReportInboundRequestSchema,
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
                description: "Invalid credentials or MFA code.",
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
