import { describe, expect, test } from "vitest";

import { handler } from "./claimsProbe.js";

void describe("HTTP API JWT claims probe", () => {
    void test("reads verified tenant and role claims from authorizer context", () => {
        const response = handler({
            requestContext: {
                authorizer: {
                    jwt: {
                        claims: {
                            tenant_id: "10000000-0000-4000-8000-000000000100",
                            roles: '["Finance Admin","Employee"]',
                        },
                    },
                },
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers).toMatchObject({
            "x-expenseflow-lambda-invoked": "true",
        });
        expect(JSON.parse(response.body)).toStrictEqual({
            verifiedClaims: {
                tenantIdPresent: true,
                roles: ["Finance Admin", "Employee"],
            },
        });
        expect(response.body).not.toContain(
            "10000000-0000-4000-8000-000000000100",
        );
    });

    void test("fails closed when authorizer claims are absent or malformed", () => {
        expect(handler({}).statusCode).toBe(500);
        expect(
            handler({
                requestContext: {
                    authorizer: {
                        jwt: {
                            claims: {
                                tenant_id: "not-a-tenant-id",
                                roles: "Unknown Role",
                            },
                        },
                    },
                },
            }).statusCode,
        ).toBe(500);
    });

    void test.each([
        ['"Finance Admin"', ["Finance Admin"]],
        ["Finance Admin", ["Finance Admin"]],
        ["[Finance Admin]", ["Finance Admin"]],
        [
            "[Finance Admin, Department Manager]",
            ["Finance Admin", "Department Manager"],
        ],
    ])("accepts a gateway role representation", (rolesClaim, expectedRoles) => {
        const response = handler({
            requestContext: {
                authorizer: {
                    jwt: {
                        claims: {
                            tenant_id: "10000000-0000-4000-8000-000000000100",
                            roles: rolesClaim,
                        },
                    },
                },
            },
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            verifiedClaims: { roles: expectedRoles },
        });
    });
});
