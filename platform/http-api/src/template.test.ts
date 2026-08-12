import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const template = readFileSync(
    fileURLToPath(new URL("../template.yaml", import.meta.url)),
    "utf8",
);
const issuerTemplate = readFileSync(
    fileURLToPath(new URL("../issuer-template.yaml", import.meta.url)),
    "utf8",
);
const issuePaymentTemplate = readFileSync(
    fileURLToPath(new URL("../issue-payment-template.yaml", import.meta.url)),
    "utf8",
);

void describe("HTTP API infrastructure template", () => {
    void test("uses a native JWT authorizer with issuer and audience", () => {
        expect(template).toContain("Type: AWS::Serverless::HttpApi");
        expect(template).toContain("DefaultAuthorizer: SharedJwtAuthorizer");
        expect(template).toContain(
            "IdentitySource: $request.header.Authorization",
        );
        expect(template).toMatch(
            /JwtConfiguration:[\s\S]*issuer: !Ref JwtIssuer/,
        );
        expect(template).toMatch(/audience:[\s\S]*- !Ref JwtAudience/);
    });

    void test("protects a payload-v2 Lambda route with the default authorizer", () => {
        expect(template).toContain("ApiId: !Ref SharedJwtHttpApi");
        expect(template).toContain("Path: /auth-context");
        expect(template).toContain('PayloadFormatVersion: "2.0"');
        expect(template).not.toContain("Authorizer: NONE");
    });

    void test("propagates the required sandbox ownership tags", () => {
        expect(template).toContain("EnvironmentTag:");
        expect(template).toContain("UserTag:");
        expect(template).toContain("- sandbox");
        expect(template).toContain("- muhilramesh");
        expect(template.match(/PropagateTags: true/g)).toHaveLength(2);
        expect(template).toContain("env: !Ref EnvironmentTag");
        expect(template).toContain("user: !Ref UserTag");
    });

    void test("creates a bounded and tagged Lambda execution role", () => {
        expect(template).toContain("Type: AWS::IAM::Role");
        expect(template).toContain(
            "PermissionsBoundary: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:policy/TraineeSandboxBoundary",
        );
        expect(template).toContain("Role: !GetAtt ClaimsProbeFunctionRole.Arn");
    });
});

void describe("JWT issuer infrastructure template", () => {
    void test("publishes only the discovery and JWKS routes", () => {
        expect(issuerTemplate).toContain(
            "Path: /.well-known/openid-configuration",
        );
        expect(issuerTemplate).toContain("Path: /.well-known/jwks.json");
        expect(issuerTemplate.match(/Type: HttpApi/g)).toHaveLength(2);
    });

    void test("bounds throttling, execution time, memory, and log retention", () => {
        expect(issuerTemplate).toContain("ThrottlingRateLimit: 5");
        expect(issuerTemplate).toContain("MemorySize: 128");
        expect(issuerTemplate).toContain("Timeout: 5");
        expect(issuerTemplate).toContain("RetentionInDays: 14");
    });

    void test("propagates required tags to taggable resources", () => {
        expect(issuerTemplate.match(/PropagateTags: true/g)).toHaveLength(2);
        expect(issuerTemplate).toContain("env: !Ref EnvironmentTag");
        expect(issuerTemplate).toContain("user: !Ref UserTag");
        expect(issuerTemplate).toContain("- Key: env");
        expect(issuerTemplate).toContain("- Key: user");
    });

    void test("creates a bounded and tagged Lambda execution role", () => {
        expect(issuerTemplate).toContain("Type: AWS::IAM::Role");
        expect(issuerTemplate).toContain(
            "PermissionsBoundary: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:policy/TraineeSandboxBoundary",
        );
        expect(issuerTemplate).toContain(
            "Role: !GetAtt JwtIssuerFunctionRole.Arn",
        );
    });
});

void describe("Issue Payment HTTP API infrastructure template", () => {
    void test("attaches a protected JWT route to the shared HTTP API", () => {
        expect(issuePaymentTemplate).toContain("HttpApiId:");
        expect(issuePaymentTemplate).toContain("SharedJwtAuthorizerId:");
        expect(issuePaymentTemplate).toContain(
            "Type: AWS::ApiGatewayV2::Route",
        );
        expect(issuePaymentTemplate).toContain(
            "RouteKey: POST /expense-reports/{id}/settlement",
        );
        expect(issuePaymentTemplate).toContain("AuthorizationType: JWT");
        expect(issuePaymentTemplate).toContain(
            "AuthorizerId: !Ref SharedJwtAuthorizerId",
        );
    });

    void test("configures only Core Case command environment for the Lambda", () => {
        expect(issuePaymentTemplate).toContain(
            "Handler: issuePaymentStub.handler",
        );
        expect(issuePaymentTemplate).toContain("CORE_CASE_INTERNAL_BASE_URL");
        expect(issuePaymentTemplate).toContain(
            "CORE_CASE_INTERNAL_COMMAND_TOKEN",
        );
        expect(issuePaymentTemplate).not.toContain("DATABASE_URL_SECRET_ID");
        expect(issuePaymentTemplate).not.toContain(
            "secretsmanager:GetSecretValue",
        );
    });

    void test("bounds Lambda size, role permissions, retention, and tags", () => {
        expect(issuePaymentTemplate).toContain("MemorySize: 128");
        expect(issuePaymentTemplate).toContain("Timeout: 5");
        expect(issuePaymentTemplate).toContain("RetentionInDays: 14");
        expect(issuePaymentTemplate).toContain(
            "PermissionsBoundary: !Ref RolePermissionsBoundaryArn",
        );
        expect(issuePaymentTemplate).toContain("logs:CreateLogStream");
        expect(issuePaymentTemplate).toContain("logs:PutLogEvents");
        expect(issuePaymentTemplate).toContain("ticket: !Ref TicketTag");
        expect(issuePaymentTemplate).toContain("user: !Ref UserTag");
    });
});
