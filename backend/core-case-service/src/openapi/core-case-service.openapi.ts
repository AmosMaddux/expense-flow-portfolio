import {
    OpenApiGeneratorV31,
    OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas31";
import { z } from "zod";

import {
    CaseQueueStageRollupListSchema,
    CreateExpenseReportInboundRequestSchema,
    ExpenseReportOutboundResponseSchema,
    ReadCaseQueueStageRollupsInboundRequestSchema,
} from "../schemas/expense-report.schema.js";

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
    const createExpenseReportRequest = registry.register(
        "CreateExpenseReportRequest",
        CreateExpenseReportInboundRequestSchema,
    );
    const expenseReportResponse = registry.register(
        "ExpenseReportResponse",
        ExpenseReportOutboundResponseSchema,
    );
    const readCaseQueueStageRollupsRequest = registry.register(
        "ReadCaseQueueStageRollupsRequest",
        ReadCaseQueueStageRollupsInboundRequestSchema,
    );
    const caseQueueStageRollupList = registry.register(
        "CaseQueueStageRollupList",
        CaseQueueStageRollupListSchema,
    );
    const problemJson = registry.register("ProblemJson", problemJsonSchema);

    registry.registerPath({
        method: "get",
        path: "/case-queue/rollups",
        summary: "Get Case Queue rollups",
        description:
            "Loads tenant-scoped Case Queue rollups from the Redis cache or DynamoDB source of record.",
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
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "post",
        path: "/expense-reports",
        summary: "Create an Expense Report",
        description:
            "Creates an Expense Report case in Drafted stage and records the initial audit and stage-transition entries.",
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
            500: problemJsonResponse("Unexpected server error."),
        },
    });

    registry.registerPath({
        method: "get",
        path: "/expense-reports/{id}",
        summary: "Get an Expense Report",
        description: "Loads an Expense Report case by identifier.",
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
            title: "ExpenseFlow Core Case Service API",
            version: "1.0.0",
            description:
                "Discoverable contract for Core Case Service Expense Report endpoints.",
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
