import { z, ZodError } from "zod";

import {
    jwtRolesClaimSchema,
    parseJwtRolesClaim,
    type RoleName,
} from "./httpApiJwtClaims.js";

const defaultSettlementReason = "Settlement saga completed.";
const internalCommandTokenHeader = "x-core-case-internal-command-token";

const authorizerClaimsSchema = z.object({
    sub: z.uuid(),
    tenant_id: z.uuid(),
    roles: jwtRolesClaimSchema,
});

const httpApiRequestSchema = z.object({
    pathParameters: z.object({
        id: z.uuid(),
    }),
    headers: z.record(z.string(), z.string()),
    body: z.string().optional(),
    isBase64Encoded: z.boolean().optional(),
});

const requestHeadersSchema = z.object({
    "idempotency-key": z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9._:-]+$/),
    "x-correlation-id": z.uuid(),
});

const issuePaymentStubBodySchema = z
    .object({
        reason: z.string().trim().min(1).optional(),
    })
    .strict();

const environmentSchema = z.object({
    CORE_CASE_INTERNAL_BASE_URL: z.url(),
    CORE_CASE_INTERNAL_COMMAND_TOKEN: z.string().min(32),
    CORE_CASE_INTERNAL_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1)
        .max(30_000)
        .default(5_000),
});

const httpApiResponseSchema = z.object({
    statusCode: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
});

type HttpApiResponse = z.infer<typeof httpApiResponseSchema>;
type IssuePaymentStubFetch = typeof fetch;

export type IssuePaymentStubHandlerDependencies = {
    fetch?: IssuePaymentStubFetch;
    environment?: NodeJS.ProcessEnv;
};

class BadRequestError extends Error {
    public constructor(message = "The Issue Payment request is invalid.") {
        super(message);
        this.name = "BadRequestError";
    }
}

class InvalidAuthorizerContextError extends Error {
    public constructor() {
        super("Verified tenant, actor, and role claims were not available.");
        this.name = "InvalidAuthorizerContextError";
    }
}

class UpstreamResponseError extends Error {
    public constructor(
        public readonly statusCode: number,
        public readonly detail: string,
    ) {
        super(detail);
        this.name = "UpstreamResponseError";
    }
}

/**
 * Creates the API Gateway handler that forwards Issue Payment stub commands to Core Case.
 */
export function createIssuePaymentStubHandler(
    dependencies: IssuePaymentStubHandlerDependencies = {},
): (event: unknown) => Promise<HttpApiResponse> {
    return async (event: unknown): Promise<HttpApiResponse> => {
        try {
            const claims = readVerifiedClaims(event);
            const request = parseIssuePaymentRequest(event);
            const environment = environmentSchema.parse(
                dependencies.environment ?? process.env,
            );

            return await forwardIssuePaymentCommand({
                claims,
                commandFetch: dependencies.fetch ?? fetch,
                environment,
                request,
            });
        } catch (error: unknown) {
            return mapErrorToResponse(error);
        }
    };
}

/**
 * Handles public Issue Payment stub requests from API Gateway HTTP API.
 */
export const handler = createIssuePaymentStubHandler();

function readVerifiedClaims(event: unknown): {
    actorId: string;
    roles: RoleName[];
    tenantId: string;
} {
    const parsedClaims = z
        .object({
            requestContext: z.object({
                authorizer: z.object({
                    jwt: z.object({
                        claims: authorizerClaimsSchema,
                    }),
                }),
            }),
        })
        .safeParse(event);

    if (!parsedClaims.success) {
        throw new InvalidAuthorizerContextError();
    }

    try {
        return {
            actorId: parsedClaims.data.requestContext.authorizer.jwt.claims.sub,
            roles: parseJwtRolesClaim(
                parsedClaims.data.requestContext.authorizer.jwt.claims.roles,
            ),
            tenantId:
                parsedClaims.data.requestContext.authorizer.jwt.claims
                    .tenant_id,
        };
    } catch {
        throw new InvalidAuthorizerContextError();
    }
}

function parseIssuePaymentRequest(event: unknown): {
    correlationId: string;
    expenseReportId: string;
    idempotencyKey: string;
    reason: string;
} {
    try {
        const request = httpApiRequestSchema.parse(event);
        const headers = requestHeadersSchema.parse(
            normalizeHeaders(request.headers),
        );
        const body = issuePaymentStubBodySchema.parse(
            parseJsonBody(request.body, request.isBase64Encoded),
        );

        return {
            correlationId: headers["x-correlation-id"],
            expenseReportId: request.pathParameters.id,
            idempotencyKey: headers["idempotency-key"],
            reason: body.reason ?? defaultSettlementReason,
        };
    } catch (error: unknown) {
        if (error instanceof ZodError || error instanceof SyntaxError) {
            throw new BadRequestError();
        }

        throw error;
    }
}

function normalizeHeaders(
    headers: Record<string, string>,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
            key.toLowerCase(),
            value,
        ]),
    );
}

function parseJsonBody(
    body: string | undefined,
    isBase64Encoded: boolean | undefined,
): unknown {
    if (body === undefined || body.trim() === "") {
        return {};
    }

    const decodedBody =
        isBase64Encoded === true
            ? Buffer.from(body, "base64").toString("utf8")
            : body;

    return JSON.parse(decodedBody);
}

async function forwardIssuePaymentCommand(input: {
    claims: { actorId: string; roles: RoleName[]; tenantId: string };
    commandFetch: IssuePaymentStubFetch;
    environment: z.infer<typeof environmentSchema>;
    request: {
        correlationId: string;
        expenseReportId: string;
        idempotencyKey: string;
        reason: string;
    };
}): Promise<HttpApiResponse> {
    const coreCaseResponse = await fetchCoreCaseCommand(input);
    const coreCaseBody = await coreCaseResponse.text();
    const coreCaseContentType =
        coreCaseResponse.headers.get("content-type") ?? "application/json";
    const correlationId = coreCaseResponse.headers.get("x-correlation-id");

    if (coreCaseBody.trim() === "") {
        throw new UpstreamResponseError(
            coreCaseResponse.ok ? 502 : coreCaseResponse.status,
            "Core Case returned an empty response body.",
        );
    }

    try {
        JSON.parse(coreCaseBody);
    } catch {
        throw new UpstreamResponseError(
            coreCaseResponse.ok ? 502 : coreCaseResponse.status,
            "Core Case returned a response body that was not JSON.",
        );
    }

    return httpApiResponseSchema.parse({
        statusCode: coreCaseResponse.status,
        headers: {
            "content-type": coreCaseContentType,
            ...(correlationId === null
                ? {}
                : { "x-correlation-id": correlationId }),
        },
        body: coreCaseBody,
    });
}

async function fetchCoreCaseCommand(input: {
    claims: { actorId: string; roles: RoleName[]; tenantId: string };
    commandFetch: IssuePaymentStubFetch;
    environment: z.infer<typeof environmentSchema>;
    request: {
        correlationId: string;
        expenseReportId: string;
        idempotencyKey: string;
        reason: string;
    };
}): Promise<Response> {
    const endpointUrl = new URL(
        `/v1/internal/expense-reports/${input.request.expenseReportId}/payment-stub-settlement`,
        `${input.environment.CORE_CASE_INTERNAL_BASE_URL.replace(/\/$/, "")}/`,
    );

    try {
        return await input.commandFetch(endpointUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "idempotency-key": input.request.idempotencyKey,
                [internalCommandTokenHeader]:
                    input.environment.CORE_CASE_INTERNAL_COMMAND_TOKEN,
                "x-correlation-id": input.request.correlationId,
            },
            body: JSON.stringify({
                tenantId: input.claims.tenantId,
                actorId: input.claims.actorId,
                roles: input.claims.roles,
                reason: input.request.reason,
            }),
            signal: AbortSignal.timeout(
                input.environment.CORE_CASE_INTERNAL_TIMEOUT_MS,
            ),
        });
    } catch {
        throw new UpstreamResponseError(
            502,
            "Core Case could not be reached for Issue Payment settlement.",
        );
    }
}

function mapErrorToResponse(error: unknown): HttpApiResponse {
    if (error instanceof InvalidAuthorizerContextError) {
        return problemResponse(
            500,
            "Invalid authorizer context",
            "Verified tenant, actor, and role claims were not available.",
        );
    }

    if (error instanceof BadRequestError) {
        return problemResponse(
            400,
            "Bad Request",
            "The Issue Payment request is invalid.",
        );
    }

    if (error instanceof UpstreamResponseError) {
        return problemResponse(error.statusCode, "Bad Gateway", error.detail);
    }

    if (error instanceof ZodError) {
        return problemResponse(
            500,
            "Issue Payment configuration unavailable",
            "The Issue Payment Lambda configuration is unavailable.",
        );
    }

    return problemResponse(
        500,
        "Internal Server Error",
        "An unexpected Issue Payment Lambda error occurred.",
    );
}

function problemResponse(
    statusCode: number,
    title: string,
    detail: string,
): HttpApiResponse {
    return httpApiResponseSchema.parse({
        statusCode,
        headers: {
            "content-type": "application/problem+json",
            "x-expenseflow-lambda-invoked": "true",
        },
        body: JSON.stringify({
            type: "about:blank",
            title,
            status: statusCode,
            detail,
        }),
    });
}
