import { describe, expect, test } from "vitest";

import { coreCaseServiceOpenApiDocument } from "./core-case-service.openapi.js";

const document = coreCaseServiceOpenApiDocument;

void describe("coreCaseServiceOpenApiDocument", () => {
    void test("documents the planned Expense Report collection and detail endpoints", () => {
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];

        expect(expenseReportsPath?.post).toBeDefined();
        expect(expenseReportByIdPath?.get).toBeDefined();
    });

    void test("documents the POST request body from the create Expense Report DTO", () => {
        const expenseReportsPath = document.paths?.["/expense-reports"];
        const requestBody = expenseReportsPath?.post?.requestBody;

        expect(JSON.stringify(requestBody)).toContain(
            "#/components/schemas/CreateExpenseReportRequest",
        );
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

    void test("does not require a tenant query parameter for GET", () => {
        const expenseReportByIdPath = document.paths?.["/expense-reports/{id}"];
        const parameter = expenseReportByIdPath?.get?.parameters?.find(
            (candidate) => "name" in candidate && candidate.name === "tenantId",
        );

        expect(parameter).toBeUndefined();
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
});
