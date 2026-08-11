import { generateKeyPairSync } from "node:crypto";

import { describe, expect, test } from "vitest";

import { syntheticRsaPrivateKeyBase64 } from "../testSupport/jwtTestKeys.js";
import {
    buildAuthJwks,
    buildAuthOpenIdConfiguration,
    loadAuthJwtConfig,
} from "./authJwtConfig.js";

void describe("JWT authentication configuration", () => {
    void test("loads RSA JWT issuer settings and derives a public JWKS", () => {
        const config = loadAuthJwtConfig({
            AUTH_JWT_ISSUER: "expenseflow-auth-test",
            AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
            AUTH_JWT_KEY_ID: "synthetic-key-v1",
            AUTH_ACCESS_TOKEN_TTL_SECONDS: "600",
        });

        expect(config).toMatchObject({
            issuer: "expenseflow-auth-test",
            audience: "expenseflow-http-api",
            keyId: "synthetic-key-v1",
            accessTokenTtlSeconds: 600,
        });
        expect(config.privateKey.asymmetricKeyType).toBe("rsa");
        const jwks = buildAuthJwks(config);
        expect(jwks.keys).toHaveLength(1);
        const [publicJwk] = jwks.keys;
        expect(publicJwk).toMatchObject({
            alg: "RS256",
            kid: "synthetic-key-v1",
            kty: "RSA",
            use: "sig",
        });
        expect(typeof publicJwk?.e).toBe("string");
        expect(typeof publicJwk?.n).toBe("string");
    });

    void test("uses stable issuer and access token lifetime defaults", () => {
        const config = loadAuthJwtConfig({
            AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
            AUTH_JWT_KEY_ID: "synthetic-key-v1",
        });

        expect(config).toMatchObject({
            issuer: "expenseflow-core-case-service",
            audience: "expenseflow-http-api",
            keyId: "synthetic-key-v1",
            accessTokenTtlSeconds: 900,
        });
        expect(config.privateKey.asymmetricKeyType).toBe("rsa");
    });

    void test("builds HTTPS issuer metadata for API Gateway JWKS discovery", () => {
        const config = loadAuthJwtConfig({
            AUTH_JWT_ISSUER: "https://auth.expenseflow.example.test/v1/",
            AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
            AUTH_JWT_KEY_ID: "synthetic-key-v1",
        });

        expect(buildAuthOpenIdConfiguration(config)).toStrictEqual({
            issuer: "https://auth.expenseflow.example.test/v1",
            jwks_uri:
                "https://auth.expenseflow.example.test/v1/.well-known/jwks.json",
        });
    });

    void test("rejects non-HTTPS issuer metadata", () => {
        const config = loadAuthJwtConfig({
            AUTH_JWT_ISSUER: "expenseflow-auth-test",
            AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
            AUTH_JWT_KEY_ID: "synthetic-key-v1",
        });

        expect(() => buildAuthOpenIdConfiguration(config)).toThrow(
            "AUTH_JWT_ISSUER",
        );
    });

    void test("rejects missing or malformed JWT private keys and key IDs", () => {
        expect(() => loadAuthJwtConfig({})).toThrow();
        expect(() =>
            loadAuthJwtConfig({
                AUTH_JWT_PRIVATE_KEY_BASE64: syntheticRsaPrivateKeyBase64,
            }),
        ).toThrow();
        expect(() =>
            loadAuthJwtConfig({
                AUTH_JWT_PRIVATE_KEY_BASE64:
                    Buffer.from("not a pem key").toString("base64"),
                AUTH_JWT_KEY_ID: "synthetic-key-v1",
            }),
        ).toThrow("AUTH_JWT_PRIVATE_KEY_BASE64");
        expect(() =>
            loadAuthJwtConfig({
                AUTH_JWT_PRIVATE_KEY_BASE64: "not-base64",
                AUTH_JWT_KEY_ID: "synthetic-key-v1",
            }),
        ).toThrow("AUTH_JWT_PRIVATE_KEY_BASE64");
    });

    void test("rejects non-RSA private keys", () => {
        const { privateKey } = generateKeyPairSync("ed25519");
        const nonRsaPrivateKeyBase64 = Buffer.from(
            privateKey.export({
                type: "pkcs8",
                format: "pem",
            }),
        ).toString("base64");

        expect(() =>
            loadAuthJwtConfig({
                AUTH_JWT_PRIVATE_KEY_BASE64: nonRsaPrivateKeyBase64,
                AUTH_JWT_KEY_ID: "synthetic-key-v1",
            }),
        ).toThrow("AUTH_JWT_PRIVATE_KEY_BASE64");
    });
});
