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
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];

        expect(expenseReportsPath?.post).toBeDefined();
        expect(expenseReportByIdPath?.get).toBeDefined();
    });

    void test("documents the login endpoint and token response fields", () => {
        const loginPath = document.paths?.["/auth/login"];
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
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const requestBody = expenseReportsPath?.post?.requestBody;
        const createRequestSchema =
            document.components?.schemas?.CreateExpenseReportRequest;

        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/CreateExpenseReportRequest",
        );
        expect(JSON.stringify(createRequestSchema)).not.toContain("tenant_id");
    });

    void test("documents bearer authentication for every Expense Report route", () => {
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];

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
        expect(expenseReportsPath?.post?.responses?.[401]).toBeDefined();
        expect(expenseReportByIdPath?.get?.responses?.[401]).toBeDefined();
    });

    void test("documents the GET id path parameter as a required UUID", () => {
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];
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
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];
        const tenantHeader = expenseReportByIdPath?.get?.parameters?.find(
            (candidate) =>
                "name" in candidate &&
                candidate.name === "x-expenseflow-tenant-id",
        );

        expect(expenseReportByIdPath?.get?.parameters).toHaveLength(1);
        expect(tenantHeader).toBeUndefined();
    });

    void test("documents successful responses from the outbound Expense Report DTO", () => {
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];

        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[201]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[200]),
        ).toContain("#/components/schemas/ExpenseReportResponse");
    });

    void test("documents Problem+JSON responses for validation, not found, and server errors", () => {
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];

        expect(
            JSON.stringify(expenseReportsPath?.post?.responses?.[400]),
        ).toContain("#/components/schemas/ProblemJson");
        expect(
            JSON.stringify(expenseReportByIdPath?.get?.responses?.[404]),
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

    void test("keeps the committed OpenAPI document in sync with the generated document", async () => {
        const committedDocument = JSON.parse(
            await readFile(committedOpenApiDocumentUrl, "utf8"),
        ) as unknown;

        expect(committedDocument).toStrictEqual(document);
    });
});
