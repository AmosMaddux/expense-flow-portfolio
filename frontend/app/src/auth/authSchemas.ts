import { z } from "zod";

export const roleSchema = z.enum([
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
]);

export const loginRequestSchema = z.object({
    tenantId: z.uuid(),
    email: z.email(),
    password: z.string().min(1),
    totpCode: z
        .string()
        .regex(/^\d{6,8}$/)
        .optional(),
});

export const refreshRequestSchema = z.object({
    refreshToken: z.string().min(1),
});

export const logoutRequestSchema = refreshRequestSchema;

export const tokenResponseSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.iso.datetime(),
    refreshToken: z.string().min(1),
    refreshTokenExpiresAt: z.iso.datetime(),
});

const accessTokenClaimsSchema = z.object({
    sub: z.uuid(),
    tenant_id: z.uuid(),
    roles: z.array(roleSchema).min(1),
    token_use: z.literal("access"),
});

export const authSessionSchema = tokenResponseSchema.extend({
    roles: z.array(roleSchema).min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type Role = z.infer<typeof roleSchema>;

/**
 * Builds a validated client session from an auth token response.
 */
export function createAuthSession(response: unknown): AuthSession {
    const tokens = tokenResponseSchema.parse(response);
    const claims = accessTokenClaimsSchema.parse(
        decodeJwtPayload(tokens.accessToken),
    );

    if (claims.sub !== tokens.userId || claims.tenant_id !== tokens.tenantId) {
        throw new Error(
            "Authentication response identity did not match its access token.",
        );
    }

    return authSessionSchema.parse({
        ...tokens,
        roles: claims.roles,
    });
}

function decodeJwtPayload(token: string): unknown {
    const payload = token.split(".")[1];

    if (payload === undefined) {
        throw new Error(
            "Authentication response contained an invalid access token.",
        );
    }

    try {
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const decoded = atob(
            normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
        );

        return JSON.parse(decoded) as unknown;
    } catch {
        throw new Error(
            "Authentication response contained an invalid access token.",
        );
    }
}
