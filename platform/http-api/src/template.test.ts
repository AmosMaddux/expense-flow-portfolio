import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const template = readFileSync(
    fileURLToPath(new URL("../template.yaml", import.meta.url)),
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
});
