import {
    OpenApiGeneratorV31,
    OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import { z } from "zod";

import {
    CreateExpenseReportInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
} from "../schemas/expense-report.schema.js";
import {
    loginRequestSchema,
    loginResponseSchema,
} from "../auth/login/loginService.js";
import {
    mfaEnrollmentRequestSchema,
    mfaEnrollmentResponseSchema,
} from "../auth/mfa/mfaEnrollmentService.js";

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
    const mfaEnrollmentRequest = registry.register(
        "MfaEnrollmentRequest",
        mfaEnrollmentRequestSchema,
    );
    const mfaEnrollmentResponse = registry.register(
        "MfaEnrollmentResponse",
        mfaEnrollmentResponseSchema,
    );
    const problemJson = registry.register("ProblemJson", problemJsonSchema);
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
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
                    },
                },
            },
            400: problemJsonResponse("Malformed create request."),
            401: problemJsonResponse("Valid access token required."),
            403: problemJsonResponse("Authenticated role is not permitted."),
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
                content: {
                    "application/json": {
                        schema: expenseReportResponse,
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
                "Version 1 contract for Core Case Service endpoints. Fields are never removed or changed silently within v1: a field is first marked deprecated with a migration note and remains supported until a future API version.",
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
}

export const coreCaseServiceOpenApiDocument =
    generateCoreCaseServiceOpenApiDocument();
