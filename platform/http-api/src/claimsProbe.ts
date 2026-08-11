import { z } from "zod";

const roleSchema = z.enum([
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
]);

const authorizerClaimsSchema = z.object({
    tenant_id: z.uuid(),
    roles: z.union([z.string().min(1), z.array(roleSchema).min(1)]),
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

const serializedRolesSchema = z.string().transform((value, context) => {
    try {
        const decodedValue: unknown = JSON.parse(value);
        const decodedRoles = z.array(roleSchema).min(1).safeParse(decodedValue);
        if (decodedRoles.success) {
            return decodedRoles.data;
        }

        const decodedRole = roleSchema.safeParse(decodedValue);
        if (decodedRole.success) {
            return [decodedRole.data];
        }
    } catch {
        // Continue with API Gateway's non-JSON string representations.
    }

    const singleRole = roleSchema.safeParse(value);
    if (singleRole.success) {
        return [singleRole.data];
    }

    const bracketedRoles = /^\[(.*)\]$/.exec(value.trim());
    if (bracketedRoles !== null) {
        const roles = z
            .array(roleSchema)
            .min(1)
            .safeParse(
                (bracketedRoles[1] ?? "")
                    .split(",")
                    .map((role) => role.trim())
                    .filter((role) => role.length > 0),
            );
        if (roles.success) {
            return roles.data;
        }
    }

    context.addIssue({
        code: "custom",
        message: "The verified roles claim is invalid.",
    });
    return z.NEVER;
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
        const roles = Array.isArray(
            request.requestContext.authorizer.jwt.claims.roles,
        )
            ? request.requestContext.authorizer.jwt.claims.roles
            : serializedRolesSchema.parse(
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
