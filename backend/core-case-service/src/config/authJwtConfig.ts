import { createPrivateKey, type KeyObject } from "node:crypto";

import { z } from "zod";

const authJwtEnvironmentSchema = z.object({
    AUTH_JWT_ISSUER: z
        .string()
        .trim()
        .min(1)
        .default("expenseflow-core-case-service"),
    AUTH_JWT_PRIVATE_KEY_BASE64: z.string().min(1),
    AUTH_JWT_KEY_ID: z.string().trim().min(1).optional(),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(900),
});

export type AuthJwtConfig = {
    issuer: string;
    privateKey: KeyObject;
    keyId?: string;
    accessTokenTtlSeconds: number;
};

/**
 * Reads and validates JWT signing settings from the service environment.
 */
export function loadAuthJwtConfig(
    environment: NodeJS.ProcessEnv = process.env,
): AuthJwtConfig {
    const parsedEnvironment = authJwtEnvironmentSchema.parse(environment);
    const privateKey = parseRsaPrivateKey(
        parsedEnvironment.AUTH_JWT_PRIVATE_KEY_BASE64,
    );

    return {
        issuer: parsedEnvironment.AUTH_JWT_ISSUER,
        privateKey,
        ...(parsedEnvironment.AUTH_JWT_KEY_ID === undefined
            ? {}
            : { keyId: parsedEnvironment.AUTH_JWT_KEY_ID }),
        accessTokenTtlSeconds: parsedEnvironment.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    };
}

function parseRsaPrivateKey(encodedPrivateKey: string): KeyObject {
    try {
        const privateKey = createPrivateKey(
            Buffer.from(encodedPrivateKey, "base64").toString("utf8"),
        );

        if (privateKey.asymmetricKeyType !== "rsa") {
            throw new Error("AUTH_JWT_PRIVATE_KEY_BASE64 must be an RSA key.");
        }

        return privateKey;
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "AUTH_JWT_PRIVATE_KEY_BASE64 must be an RSA key."
        ) {
            throw error;
        }

        throw new Error(
            "AUTH_JWT_PRIVATE_KEY_BASE64 must be a base64 PEM RSA private key.",
            { cause: error },
        );
    }
}
