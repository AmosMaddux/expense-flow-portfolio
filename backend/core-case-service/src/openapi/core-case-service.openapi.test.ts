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
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];

        expect(expenseReportsPath?.post).toBeDefined();
        expect(expenseReportByIdPath?.get).toBeDefined();
        expect(expenseReportSubmitPath?.post).toBeDefined();
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
            "Invalid credentials or MFA code",
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

    void test("documents bearer authentication for every Expense Report route", () => {
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];

        expect(document.components?.securitySchemes?.bearerAuth).toMatchObject({
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
        });
        expect(expenseReportsPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportByIdPath?.get?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportSubmitPath?.post?.security).toStrictEqual([
            { bearerAuth: [] },
        ]);
        expect(expenseReportsPath?.post?.responses?.[401]).toBeDefined();
        expect(expenseReportsPath?.post?.responses?.[403]).toBeDefined();
        expect(expenseReportByIdPath?.get?.responses?.[401]).toBeDefined();
        expect(expenseReportByIdPath?.get?.responses?.[403]).toBeDefined();
        expect(expenseReportSubmitPath?.post?.responses?.[401]).toBeDefined();
        expect(expenseReportSubmitPath?.post?.responses?.[403]).toBeDefined();
    });

    void test("documents the GET id path parameter as a required UUID", () => {
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const parameter = expenseReportByIdPath?.get?.parameters?.[0];

        expect(parameter).toMatchObject({
            in: "path",
            name: "id",
            required: true,
            schema: {
                type: "string",
                format: "uuid",
            },
        });
    });

    void test("documents GET with only the id path parameter", () => {
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const tenantHeader = expenseReportByIdPath?.get?.parameters?.find(
            (candidate) =>
                "name" in candidate &&
                candidate.name === "x-expenseflow-tenant-id",
        );

        expect(expenseReportByIdPath?.get?.parameters).toHaveLength(1);
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

    void test("documents successful responses from the outbound Expense Report DTO", () => {
        const expenseReportsPath = document.paths?.["/v1/expense-reports"];
        const expenseReportByIdPath =
            document.paths?.["/v1/expense-reports/{id}"];
        const expenseReportSubmitPath =
            document.paths?.["/v1/expense-reports/{id}/submit"];

        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[201]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[200]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
        expect(
            JSON.stringify(expenseReportSubmitPath?.post?.responses?.[201]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
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

        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[400]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[404]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportSubmitPath?.post?.responses?.[409]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[500]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[500]),
        ).toContain("#/components/schemas/ProblemJson");
    });

    void test("documents active Expense Report endpoint behavior", () => {
        const serializedDocument = JSON.stringify(document).toLowerCase();

        expect(serializedDocument).toContain("records the initial audit");
        expect(serializedDocument).toContain(
            "expense report case by identifier",
        );
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
