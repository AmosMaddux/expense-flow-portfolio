import { afterEach, describe, expect, test } from "vitest";

import { handler } from "./jwtIssuer.js";

const originalJwks = process.env.AUTH_JWT_JWKS_JSON;
const syntheticJwks = {
    keys: [
        {
            kty: "RSA",
            kid: "synthetic-key-v1",
            use: "sig",
            alg: "RS256",
            n: "synthetic-public-modulus",
            e: "AQAB",
        },
    ],
};

function event(rawPath: string): unknown {
    return {
        rawPath,
        requestContext: {
            domainName: "synthetic-issuer.example.test",
        },
    };
}

void describe("shared JWT issuer Lambda", () => {
    afterEach(() => {
        if (originalJwks === undefined) {
            delete process.env.AUTH_JWT_JWKS_JSON;
            return;
        }
        process.env.AUTH_JWT_JWKS_JSON = originalJwks;
    });

    void test("publishes discovery metadata derived from trusted gateway context", () => {
        process.env.AUTH_JWT_JWKS_JSON = JSON.stringify(syntheticJwks);

        const result = handler(event("/.well-known/openid-configuration"));

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toStrictEqual({
            issuer: "https://synthetic-issuer.example.test",
            jwks_uri:
                "https://synthetic-issuer.example.test/.well-known/jwks.json",
        });
    });

    void test("publishes only validated RSA public keys", () => {
        process.env.AUTH_JWT_JWKS_JSON = JSON.stringify(syntheticJwks);

        const result = handler(event("/.well-known/jwks.json"));

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toStrictEqual(syntheticJwks);
        expect(result.body).not.toContain("PRIVATE");
    });

    void test("returns bounded errors for unknown paths and invalid configuration", () => {
        process.env.AUTH_JWT_JWKS_JSON = JSON.stringify(syntheticJwks);
        expect(handler(event("/unknown")).statusCode).toBe(404);

        process.env.AUTH_JWT_JWKS_JSON = "invalid";
        expect(handler(event("/.well-known/jwks.json")).statusCode).toBe(500);
    });
});
