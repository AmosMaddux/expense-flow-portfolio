import { z } from "zod";

import { jwtRolesClaimSchema, parseJwtRolesClaim } from "./httpApiJwtClaims.js";

const authorizerClaimsSchema = z.object({
    tenant_id: z.uuid(),
    roles: jwtRolesClaimSchema,
});

const httpApiRequestSchema = z.object({
    requestContext: z.object({
        authorizer: z.object({
            jwt: z.object({
                claims: authorizerClaimsSchema,
            }),
        }),
    }),
});

type HttpApiResponse = {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
};

/**
 * Confirms API Gateway supplied verified tenant and role claims to Lambda.
 */
export function handler(event: unknown): HttpApiResponse {
    try {
        const request = httpApiRequestSchema.parse(event);
        const roles = parseJwtRolesClaim(
            request.requestContext.authorizer.jwt.claims.roles,
        );

        return {
            statusCode: 200,
            headers: {
                "content-type": "application/json",
                "x-expenseflow-lambda-invoked": "true",
            },
            body: JSON.stringify({
                verifiedClaims: {
                    tenantIdPresent: true,
                    roles,
                },
            }),
        };
    } catch {
        return {
            statusCode: 500,
            headers: {
                "content-type": "application/problem+json",
                "x-expenseflow-lambda-invoked": "true",
            },
            body: JSON.stringify({
                type: "about:blank",
                title: "Invalid authorizer context",
                status: 500,
                detail: "Verified tenant and role claims were not available.",
            }),
        };
    }
}
