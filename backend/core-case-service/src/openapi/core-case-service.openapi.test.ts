import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { coreCaseServiceOpenApiDocument } from "./core-case-service.openapi.js";

const document = coreCaseServiceOpenApiDocument;
const committedOpenApiDocumentUrl = new URL(
    "../../../../docs/openapi/core-case-service.openapi.json",
    import.meta.url,
);

void describe("coreCaseServiceOpenApiDocument", () => {
    void test("documents the planned Expense Report collection and detail endpoints", () => {
        const caseQueueLineItemsPath =
            document.paths?.["/v1/case-queue/line-items"];
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const reviewDetailPath =
            document.paths?.["/v1/expense-reports/{id}/review-detail"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];
        const expenseReportSettlementPath =
            document.paths?.["/v1/expense-reports/{id}/settlement"];
        const auditEntriesPath =
            document.paths?.["/v1/expense-reports/{id}/audit-entries"];
        const flagClearPath =
            document.paths?.["/v1/expense-reports/{id}/flags/clear"];
        const transactionsPath = document.paths?.["/v1/transactions"];
        const lineItemReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/line-items/{sourceId}/review"
            ];
        const sourceReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review"
            ];

        expect(caseQueueLineItemsPath?.get).toBeDefined();
        expect(expenseReportsPath?.post).toBeDefined();
        expect(expenseReportByIdPath?.get).toBeDefined();
        expect(reviewDetailPath?.get).toBeDefined();
        expect(expenseReportSubmitPath?.post).toBeDefined();
        expect(expenseReportSettlementPath?.post).toBeDefined();
        expect(flagClearPath?.post).toBeDefined();
        expect(lineItemReviewPath?.post).toBeDefined();
        expect(sourceReviewPath?.post).toBeDefined();
        expect(auditEntriesPath?.get).toBeDefined();
        expect(transactionsPath?.get).toBeDefined();
    });

    void test("documents receipt-byte uploads and idempotent mileage creation", () => {
        const receiptUploadPath =
            document.paths?.[
                "/v1/expense-reports/{id}/receipt-uploads/{uploadId}"
            ];
        const mileagePath =
            document.paths?.["/v1/expense-reports/{id}/mileage-entries"];
        const mileageIdempotencyHeader = mileagePath?.post?.parameters?.find(
            (parameter) =>
                "name" in parameter && parameter.name === "Idempotency-Key",
        );

        expect(receiptUploadPath?.put).toBeDefined();
        expect(JSON.stringify(receiptUploadPath?.put?.requestBody)).toContain(
            "application/pdf",
        );
        expect(
            JSON.stringify(receiptUploadPath?.put?.responses?.[201]),
        ).toContain("#/components/schemas/ReceiptUploadResponse");
        expect(mileageIdempotencyHeader).toMatchObject({
            in: "header",
            name: "Idempotency-Key",
            required: true,
        });
    });

    void test("documents the login endpoint and token response fields", () => {
        const loginPath = document.paths?.["/v1/auth/login"];
        const requestBody = loginPath?.post?.requestBody;
        const loginResponse = document.components?.schemas?.LoginResponse;

        expect(loginPath?.post).toBeDefined();
        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/LoginRequest",
        );
        expect(JSON.stringify(loginPath?.post?.responses?.[200])).toContain(
            "#/components/schemas/LoginResponse",
        );
        expect(JSON.stringify(loginPath?.post?.responses?.[401])).toContain(
            "#/components/schemas/LoginErrorResponse",
        );
        expect(JSON.stringify(loginResponse)).toContain("accessToken");
        expect(JSON.stringify(loginResponse)).toContain("refreshToken");
    });

    void test("documents the POST request body from the create Expense Report DTO", () => {
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const requestBody = expenseReportsPath?.post?.requestBody;
        const createRequestSchema =
            document.components?.schemas?.CreateExpenseReportRequest;

        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/CreateExpenseReportRequest",
        );
        expect(JSON.stringify(createRequestSchema)).not.toContain("tenant_id");
    });

    void test("documents Idempotency-Key as required for Expense Report creation", () => {
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const idempotencyHeader = expenseReportsPath?.post?.parameters?.find(
            (parameter) =>
                "name" in parameter && parameter.name === "Idempotency-Key",
        );

        expect(idempotencyHeader).toMatchObject({
            in: "header",
            name: "Idempotency-Key",
            required: true,
        });
    });

    void test("documents Idempotency-Key as required for Expense Report submission", () => {
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];
        const idempotencyHeader =
            expenseReportSubmitPath?.post?.parameters?.find(
                (parameter) =>
                    "name" in parameter && parameter.name === "Idempotency-Key",
            );

        expect(idempotencyHeader).toMatchObject({
            in: "header",
            name: "Idempotency-Key",
            required: true,
        });
    });

    void test("documents correlation only on stage-transition request boundaries", () => {
        const createParameters =
            document.paths?.["/v1/expense-reports"]?.post?.parameters ?? [];
        const submitParameters =
            document.paths?.["/v1/expense-reports/{id}/submit"]?.post
                ?.parameters ?? [];
        const findCorrelationHeader = (
            parameter: (typeof createParameters)[number],
        ) => "name" in parameter && parameter.name === "x-correlation-id";

        expect(createParameters.find(findCorrelationHeader)).toBeUndefined();
        expect(submitParameters.find(findCorrelationHeader)).toMatchObject({
            in: "header",
            name: "x-correlation-id",
            required: false,
        });
    });

    void test("documents bearer authentication for every Expense Report route", () => {
        const caseQueueRollupsPath = document.paths?.["/v1/case-queue/rollups"];
        const financeDashboardTrendsPath =
            document.paths?.["/v1/finance-dashboard/trends"];
        const caseQueueLineItemsPath =
            document.paths?.["/v1/case-queue/line-items"];
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const reviewDetailPath =
            document.paths?.["/v1/expense-reports/{id}/review-detail"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];
        const expenseReportSettlementPath =
            document.paths?.["/v1/expense-reports/{id}/settlement"];
        const auditEntriesPath =
            document.paths?.["/v1/expense-reports/{id}/audit-entries"];
        const flagClearPath =
            document.paths?.["/v1/expense-reports/{id}/flags/clear"];
        const transactionsPath = document.paths?.["/v1/transactions"];
        const lineItemReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/line-items/{sourceId}/review"
            ];
        const sourceReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review"
            ];

        expect(document.components?.securitySchemes?.bearerAuth).toMatchObject({
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
        });
        expect(caseQueueRollupsPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(financeDashboardTrendsPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(caseQueueLineItemsPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(transactionsPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportsPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportByIdPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(reviewDetailPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportSubmitPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportSettlementPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(flagClearPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(lineItemReviewPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(sourceReviewPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(caseQueueRollupsPath?.get?.responses?.[401]).toBeDefined();
        expect(caseQueueRollupsPath?.get?.responses?.[403]).toBeDefined();
        expect(financeDashboardTrendsPath?.get?.responses?.[401]).toBeDefined();
        expect(financeDashboardTrendsPath?.get?.responses?.[403]).toBeDefined();
        expect(caseQueueLineItemsPath?.get?.responses?.[401]).toBeDefined();
        expect(caseQueueLineItemsPath?.get?.responses?.[403]).toBeDefined();
        expect(transactionsPath?.get?.responses?.[401]).toBeDefined();
        expect(transactionsPath?.get?.responses?.[403]).toBeDefined();
        expect(auditEntriesPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportsPath?.post?.responses?.[401]).toBeDefined();
        expect(expenseReportsPath?.post?.responses?.[403]).toBeDefined();
        expect(expenseReportByIdPath?.get?.responses?.[401]).toBeDefined();
        expect(expenseReportByIdPath?.get?.responses?.[403]).toBeDefined();
        expect(reviewDetailPath?.get?.responses?.[401]).toBeDefined();
        expect(reviewDetailPath?.get?.responses?.[403]).toBeDefined();
        expect(expenseReportSubmitPath?.post?.responses?.[401]).toBeDefined();
        expect(expenseReportSubmitPath?.post?.responses?.[403]).toBeDefined();
        expect(
            expenseReportSettlementPath?.post?.responses?.[401],
        ).toBeDefined();
        expect(
            expenseReportSettlementPath?.post?.responses?.[403],
        ).toBeDefined();
        expect(flagClearPath?.post?.responses?.[401]).toBeDefined();
        expect(flagClearPath?.post?.responses?.[403]).toBeDefined();
        expect(lineItemReviewPath?.post?.responses?.[401]).toBeDefined();
        expect(lineItemReviewPath?.post?.responses?.[403]).toBeDefined();
        expect(sourceReviewPath?.post?.responses?.[401]).toBeDefined();
        expect(sourceReviewPath?.post?.responses?.[403]).toBeDefined();
        expect(auditEntriesPath?.get?.responses?.[401]).toBeDefined();
        expect(auditEntriesPath?.get?.responses?.[403]).toBeDefined();
    });

    void test("documents the GET id path parameter as a required UUID", () => {
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const reviewDetailPath =
            document.paths?.["/v1/expense-reports/{id}/review-detail"];
        const auditEntriesPath =
            document.paths?.["/v1/expense-reports/{id}/audit-entries"];
        const flagClearPath =
            document.paths?.["/v1/expense-reports/{id}/flags/clear"];
        const lineItemReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/line-items/{sourceId}/review"
            ];
        const sourceReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review"
            ];
        const parameter = expenseReportByIdPath?.get?.parameters?.[0];
        const reviewDetailParameter = reviewDetailPath?.get?.parameters?.[0];
        const auditParameter = auditEntriesPath?.get?.parameters?.[0];
        const flagClearParameter = flagClearPath?.post?.parameters?.[0];
        const lineItemReviewParameters = lineItemReviewPath?.post?.parameters;
        const sourceReviewParameters = sourceReviewPath?.post?.parameters;

        expect(parameter).toMatchObject({
            in: "path",
            name: "id",
            required: true,
            schema: {
                type: "string",
                format: "uuid",
            },
        });
        expect(auditParameter).toMatchObject({
            in: "path",
            name: "id",
            required: true,
            schema: {
                type: "string",
                format: "uuid",
            },
        });
        expect(reviewDetailParameter).toMatchObject({
            in: "path",
            name: "id",
            required: true,
            schema: {
                type: "string",
                format: "uuid",
            },
        });
        expect(flagClearParameter).toMatchObject({
            in: "path",
            name: "id",
            required: true,
            schema: {
                type: "string",
                format: "uuid",
            },
        });
        expect(lineItemReviewParameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    in: "path",
                    name: "id",
                    required: true,
                    schema: {
                        type: "string",
                        format: "uuid",
                    },
                }),
                expect.objectContaining({
                    in: "path",
                    name: "sourceId",
                    required: true,
                    schema: {
                        type: "string",
                        format: "uuid",
                    },
                }),
            ]),
        );
        expect(sourceReviewParameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    in: "path",
                    name: "id",
                    required: true,
                    schema: {
                        type: "string",
                        format: "uuid",
                    },
                }),
                expect.objectContaining({
                    in: "path",
                    name: "sourceType",
                    required: true,
                    schema: {
                        type: "string",
                        enum: ["line_item", "mileage"],
                    },
                }),
                expect.objectContaining({
                    in: "path",
                    name: "sourceId",
                    required: true,
                    schema: {
                        type: "string",
                        format: "uuid",
                    },
                }),
            ]),
        );
    });

    void test("documents GET with only the id path parameter", () => {
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const auditEntriesPath =
            document.paths?.["/v1/expense-reports/{id}/audit-entries"];
        const tenantHeader = expenseReportByIdPath?.get?.parameters?.find(
            (candidate) =>
                "name" in candidate &&
                candidate.name === "x-expenseflow-tenant-id",
        );

        expect(expenseReportByIdPath?.get?.parameters).toHaveLength(1);
        expect(auditEntriesPath?.get?.parameters).toHaveLength(1);
        expect(tenantHeader).toBeUndefined();
    });

    void test("documents submit with id path parameter and strict empty body", () => {
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];
        const requestBody = expenseReportSubmitPath?.post?.requestBody;

        expect(expenseReportSubmitPath?.post?.parameters).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    in: "path",
                    name: "id",
                    required: true,
                    schema: {
                        type: "string",
                        format: "uuid",
                    },
                }),
            ]),
        );
        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/SubmitExpenseReportRequest",
        );
    });

    void test("documents the settlement saga request body", () => {
        const expenseReportSettlementPath =
            document.paths?.["/v1/expense-reports/{id}/settlement"];
        const requestBody = expenseReportSettlementPath?.post?.requestBody;
        const settlementRequestSchema =
            document.components?.schemas?.SettleExpenseReportRequest;

        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/SettleExpenseReportRequest",
        );
        expect(JSON.stringify(settlementRequestSchema)).toContain("reason");
        expect(
            JSON.stringify(expenseReportSettlementPath?.post?.responses?.[409]),
        ).toContain("compensated saga");
    });

    void test("documents the Finance Dashboard trend endpoint", () => {
        const trendPath = document.paths?.["/v1/finance-dashboard/trends"];
        const parameters = trendPath?.get?.parameters ?? [];
        const parameterNames = parameters
            .filter((parameter) => "name" in parameter)
            .map((parameter) => parameter.name);
        const responseSchema = JSON.stringify(trendPath?.get?.responses?.[200]);
        const trendPointListSchema = JSON.stringify(
            document.components?.schemas?.FinanceDashboardTrendPointList,
        );

        expect(trendPath?.get).toBeDefined();
        expect(trendPath?.get?.security).toStrictEqual([{ bearerAuth: [] }]);
        expect(parameterNames).toStrictEqual(["fromDate", "toDate"]);
        expect(JSON.stringify(parameters)).not.toContain("tenant");
        expect(responseSchema).toContain(
            "#/components/schemas/FinanceDashboardTrendPointList",
        );
        expect(trendPointListSchema).toContain("spendByCurrency");
        expect(trendPointListSchema).toContain("spendAmount");
        expect(trendPointListSchema).toContain("currency");
        expect(trendPath?.get?.responses?.[400]).toBeDefined();
        expect(trendPath?.get?.responses?.[401]).toBeDefined();
        expect(trendPath?.get?.responses?.[403]).toBeDefined();
        expect(trendPath?.get?.responses?.[429]).toBeDefined();
    });
    void test("does not document tenant input for Case Queue rollups", () => {
        const parameters =
            document.paths?.["/v1/case-queue/rollups"]?.get?.parameters ?? [];
        const parameterNames = parameters
            .filter((parameter) => "name" in parameter)
            .map((parameter) => parameter.name);

        expect(parameterNames).toStrictEqual(["asOfDate"]);
        expect(JSON.stringify(parameters)).not.toContain("tenant");
    });

    void test("documents successful responses from the outbound Expense Report DTO", () => {
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];
        const auditEntriesPath =
            document.paths?.["/v1/expense-reports/{id}/audit-entries"];
        const flagClearPath =
            document.paths?.["/v1/expense-reports/{id}/flags/clear"];
        const lineItemReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/line-items/{sourceId}/review"
            ];
        const sourceReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review"
            ];

        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[201]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[200]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
        expect(
            JSON.stringify(expenseReportSubmitPath?.post?.responses?.[201]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
        expect(
            JSON.stringify(auditEntriesPath?.get?.responses?.[200]),
        ).toContain("#/components/schemas/AuditEntryListResponse");
        expect(JSON.stringify(flagClearPath?.post?.responses?.[200])).toContain(
            "#/components/schemas/ClearExpenseReportFlagsResponse",
        );
        expect(
            JSON.stringify(lineItemReviewPath?.post?.responses?.[200]),
        ).toContain("#/components/schemas/ApprovalQueueLineItemResponse");
        expect(
            JSON.stringify(sourceReviewPath?.post?.responses?.[200]),
        ).toContain("#/components/schemas/ApprovalQueueLineItemResponse");
        expect(
            JSON.stringify(
                document.paths?.["/v1/case-queue/line-items"]?.get
                    ?.responses?.[200],
            ),
        ).toContain("#/components/schemas/ApprovalQueueLineItemListResponse");
    });

    void test("documents line-item review from the shared DTO schemas", () => {
        const lineItemReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/line-items/{sourceId}/review"
            ];
        const sourceReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review"
            ];
        const requestBody = lineItemReviewPath?.post?.requestBody;
        const sourceRequestBody = sourceReviewPath?.post?.requestBody;
        const requestSchema =
            document.components?.schemas?.ReviewExpenseReportLineItemRequest;
        const sourceParamsSchema =
            document.components?.schemas?.ReviewExpenseReportSourceParams;
        const responseSchema =
            document.components?.schemas?.ApprovalQueueLineItemResponse;

        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/ReviewExpenseReportLineItemRequest",
        );
        expect(JSON.stringify(sourceRequestBody)).toContain(
            "#/components/schemas/ReviewExpenseReportLineItemRequest",
        );
        expect(JSON.stringify(requestSchema)).toContain("approve");
        expect(JSON.stringify(requestSchema)).toContain("reject");
        expect(JSON.stringify(requestSchema)).toContain("reason");
        expect(JSON.stringify(sourceParamsSchema)).toContain("line_item");
        expect(JSON.stringify(sourceParamsSchema)).toContain("mileage");
        expect(JSON.stringify(responseSchema)).toContain("canAdvance");
    });

    void test("documents reusable tenant rate-limit headers and 429 responses", () => {
        const responses =
            document.paths?.["/v1/expense-reports"]?.post?.responses;
        const successResponse = JSON.stringify(responses?.[201]);
        const limitedResponse = JSON.stringify(responses?.[429]);
        const responseComponents = JSON.stringify(
            document.components?.responses,
        );

        expect(successResponse).toContain("RateLimit-Limit");
        expect(successResponse).toContain("RateLimit-Remaining");
        expect(successResponse).toContain("RateLimit-Reset");
        expect(successResponse).toContain("X-RateLimit-Cost");
        expect(limitedResponse).toContain(
            "#/components/responses/RateLimitExceeded",
        );
        expect(responseComponents).toContain("Retry-After");
    });

    void test("documents Problem+JSON responses for validation, not found, and server errors", () => {
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];
        const auditEntriesPath =
            document.paths?.["/v1/expense-reports/{id}/audit-entries"];
        const flagClearPath =
            document.paths?.["/v1/expense-reports/{id}/flags/clear"];
        const transactionsPath = document.paths?.["/v1/transactions"];
        const lineItemReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/line-items/{sourceId}/review"
            ];
        const sourceReviewPath =
            document.paths?.[
                "/v1/expense-reports/{id}/sources/{sourceType}/{sourceId}/review"
            ];

        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[400]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(transactionsPath?.get?.responses?.[400]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[404]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportSubmitPath?.post?.responses?.[409]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(JSON.stringify(flagClearPath?.post?.responses?.[409])).toContain(
            "#/components/schemas/ProblemJson",
        );
        expect(
            JSON.stringify(lineItemReviewPath?.post?.responses?.[400]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(lineItemReviewPath?.post?.responses?.[404]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(lineItemReviewPath?.post?.responses?.[409]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(sourceReviewPath?.post?.responses?.[400]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(sourceReviewPath?.post?.responses?.[404]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(sourceReviewPath?.post?.responses?.[409]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportSubmitPath?.post?.responses?.[502]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[500]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(transactionsPath?.get?.responses?.[500]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[500]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(auditEntriesPath?.get?.responses?.[404]),
        ).toContain("#/components/schemas/ProblemJson");
    });

    void test("documents active Expense Report endpoint behavior", () => {
        const serializedDocument = JSON.stringify(document).toLowerCase();

        expect(serializedDocument).toContain("records the initial audit");
        expect(serializedDocument).toContain(
            "expense report case by identifier",
        );
        expect(serializedDocument).toContain("audit trail view");
        expect(serializedDocument).not.toContain("planned endpoint");
    });

    void test("publishes the v1 boundary and deprecation policy", () => {
        expect(document.info.title).toContain("v1");
        expect(document.info.version).toBe("1.0.0");
        expect(document.info.description).toContain(
            "never removed or changed silently",
        );
        expect(
            Object.keys(document.paths ?? {}).every((path) =>
                path.startsWith("/v1/"),
            ),
        ).toBe(true);
    });

    void test("keeps the committed OpenAPI document in sync with the generated document", async () => {
        const committedDocument = JSON.parse(
            await readFile(committedOpenApiDocumentUrl, "utf8"),
        ) as unknown;

        expect(committedDocument).toStrictEqual(document);
    });
});
