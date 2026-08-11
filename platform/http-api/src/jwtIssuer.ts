import { z } from "zod";

const rsaPublicJwkSchema = z.object({
    kty: z.literal("RSA"),
    kid: z.string().trim().min(1),
    use: z.literal("sig"),
    alg: z.literal("RS256"),
    n: z.string().min(1),
    e: z.string().min(1),
});

const jwksSchema = z.object({
    keys: z.array(rsaPublicJwkSchema).min(1),
});

const environmentSchema = z.object({
    AUTH_JWT_JWKS_JSON: z.string().min(1),
});

const httpApiRequestSchema = z.object({
    rawPath: z.string().min(1),
    requestContext: z.object({
        domainName: z.string().min(1),
    }),
});

const httpApiResponseSchema = z.object({
    statusCode: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
});

type HttpApiResponse = z.infer<typeof httpApiResponseSchema>;

/**
 * Publishes bounded issuer discovery metadata and the shared public JWKS.
 */
export function handler(event: unknown): HttpApiResponse {
    try {
        const request = httpApiRequestSchema.parse(event);
        const environment = environmentSchema.parse(process.env);
        const jwks = jwksSchema.parse(
            JSON.parse(environment.AUTH_JWT_JWKS_JSON),
        );
        const issuer = `https://${request.requestContext.domainName}`;

        if (request.rawPath === "/.well-known/openid-configuration") {
            return response(200, {
                issuer,
                jwks_uri: `${issuer}/.well-known/jwks.json`,
            });
        }

        if (request.rawPath === "/.well-known/jwks.json") {
            return response(200, jwks);
        }

        return response(404, {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            detail: "The requested issuer resource does not exist.",
        });
    } catch {
        return response(500, {
            type: "about:blank",
            title: "Issuer configuration unavailable",
            status: 500,
            detail: "The public JWT issuer configuration is unavailable.",
        });
    }
}

function response(statusCode: number, body: unknown): HttpApiResponse {
    return httpApiResponseSchema.parse({
        statusCode,
        headers: {
            "cache-control": "public, max-age=300",
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}
