import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

import { z } from "zod";

const authJwtEnvironmentSchema = z.object({
    AUTH_JWT_ISSUER: z
        .string()
        .trim()
        .min(1)
        .default("expenseflow-core-case-service"),
    AUTH_JWT_PRIVATE_KEY_BASE64: z.string().min(1),
    AUTH_JWT_KEY_ID: z.string().trim().min(1),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(900),
});

export type RsaPublicJwk = {
    kty: "RSA";
    kid: string;
    use: "sig";
    alg: "RS256";
    n: string;
    e: string;
};

export type JsonWebKeySet = {
    keys: RsaPublicJwk[];
};

export type JwtSigningConfig = {
    issuer: string;
    privateKey: KeyObject;
    keyId: string;
};

export type AccessTokenSigningConfig = JwtSigningConfig & {
    accessTokenTtlSeconds: number;
};

export type AuthJwtConfig = AccessTokenSigningConfig & {
    publicJwk: RsaPublicJwk;
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
    const publicJwk = exportRsaPublicJwk(
        derivePublicKey(privateKey),
        parsedEnvironment.AUTH_JWT_KEY_ID,
    );

    return {
        issuer: parsedEnvironment.AUTH_JWT_ISSUER,
        privateKey,
        publicJwk,
        keyId: parsedEnvironment.AUTH_JWT_KEY_ID,
        accessTokenTtlSeconds: parsedEnvironment.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    };
}

/**
 * Returns the public verification keys for JWT consumers.
 */
export function buildAuthJwks(config: AuthJwtConfig): JsonWebKeySet {
    return { keys: [config.publicJwk] };
}

function derivePublicKey(privateKey: KeyObject): KeyObject {
    const privateKeyPem = privateKey.export({
        type: "pkcs8",
        format: "pem",
    });

    return createPublicKey(privateKeyPem);
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

function exportRsaPublicJwk(publicKey: KeyObject, keyId: string): RsaPublicJwk {
    const jwk = publicKey.export({ format: "jwk" });
    if (
        jwk.kty !== "RSA" ||
        typeof jwk.n !== "string" ||
        typeof jwk.e !== "string"
    ) {
        throw new Error(
            "AUTH_JWT_PRIVATE_KEY_BASE64 must derive an RSA public key.",
        );
    }

    return {
        kty: "RSA",
        kid: keyId,
        use: "sig",
        alg: "RS256",
        n: jwk.n,
        e: jwk.e,
    };
}
