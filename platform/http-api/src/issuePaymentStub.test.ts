import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createIssuePaymentStubHandler } from "./issuePaymentStub.js";

const environment = {
    CORE_CASE_INTERNAL_BASE_URL: "https://core-case.internal.example.test",
    CORE_CASE_INTERNAL_COMMAND_TOKEN_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:000000000000:secret:expenseflow/sandbox/core-case/internal-command-token",
    CORE_CASE_INTERNAL_TIMEOUT_MS: "5000",
};
const internalCommandToken = "synthetic-core-case-internal-command-token";

function createTestHandler(
    input: {
        environment?: Record<string, string>;
        fetch?: typeof fetch;
        secretResolver?: (secretId: string) => Promise<string>;
    } = {},
) {
    const dependencies = {
        environment: input.environment ?? environment,
        secretResolver:
            input.secretResolver ??
            vi.fn().mockResolvedValue(internalCommandToken),
    };

    return createIssuePaymentStubHandler(
        input.fetch === undefined
            ? dependencies
            : { ...dependencies, fetch: input.fetch },
    );
}

function httpApiEvent(input: {
    body?: unknown;
    claims?: {
        roles?: unknown;
        sub?: string;
        tenant_id?: string;
    };
    headers?: Record<string, string>;
    id?: string;
}) {
    return {
        pathParameters: {
            id: input.id ?? "60000000-0000-4000-8000-000000000150",
        },
        headers: {
            "idempotency-key": "issue-payment-150",
            "x-correlation-id": "70000000-0000-4000-8000-000000000150",
            ...input.headers,
        },
        body: JSON.stringify(input.body ?? { reason: "Synthetic settlement." }),
        requestContext: {
            authorizer: {
                jwt: {
                    claims: {
                        sub:
                            input.claims?.sub ??
                            "50000000-0000-4000-8000-000000000150",
                        tenant_id:
                            input.claims?.tenant_id ??
                            "40000000-0000-4000-8000-000000000150",
                        roles: input.claims?.roles ?? '["Finance Admin"]',
                    },
                },
            },
        },
    };
}

function coreCaseResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json",
            "x-correlation-id": "70000000-0000-4000-8000-000000000150",
            ...headers,
        },
    });
}

function parseProblem(response: { body: string }) {
    return JSON.parse(response.body) as { title: string; status: number };
}

void describe("Issue Payment stub Lambda", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    void test("forwards a trusted Core Case command from valid authorizer claims", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            coreCaseResponse(200, {
                id: "60000000-0000-4000-8000-000000000150",
                currentStage: "Reconciled",
            }),
        );
        const secretResolver = vi.fn().mockResolvedValue(internalCommandToken);
        const handler = createTestHandler({
            fetch: fetchMock,
            secretResolver,
        });

        const response = await handler(httpApiEvent({}));
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

        expect(response.statusCode).toBe(200);
        expect(response.headers).toMatchObject({
            "content-type": "application/json",
            "x-correlation-id": "70000000-0000-4000-8000-000000000150",
        });
        expect(String(url)).toBe(
            "https://core-case.internal.example.test/v1/internal/expense-reports/60000000-0000-4000-8000-000000000150/payment-stub-settlement",
        );
        expect(secretResolver).toHaveBeenCalledWith(
            environment.CORE_CASE_INTERNAL_COMMAND_TOKEN_SECRET_ARN,
        );
        expect(init).toMatchObject({
            method: "POST",
            headers: {
                "content-type": "application/json",
                "idempotency-key": "issue-payment-150",
                "x-core-case-internal-command-token": internalCommandToken,
                "x-correlation-id": "70000000-0000-4000-8000-000000000150",
            },
        });
        expect(typeof init.body).toBe("string");
        const commandBody: unknown = JSON.parse(init.body as string);
        expect(commandBody).toStrictEqual({
            tenantId: "40000000-0000-4000-8000-000000000150",
            actorId: "50000000-0000-4000-8000-000000000150",
            roles: ["Finance Admin"],
            reason: "Synthetic settlement.",
        });
    });

    void test.each([
        [["Finance Admin"], ["Finance Admin"]],
        ['"Finance Admin"', ["Finance Admin"]],
        ["Finance Admin", ["Finance Admin"]],
        [
            "[Finance Admin, Department Manager]",
            ["Finance Admin", "Department Manager"],
        ],
    ])("accepts a gateway role representation", async (rolesClaim, roles) => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                coreCaseResponse(200, { currentStage: "Reconciled" }),
            );
        const handler = createTestHandler({ fetch: fetchMock });

        const response = await handler(
            httpApiEvent({
                claims: { roles: rolesClaim },
                body: {},
            }),
        );
        const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

        expect(response.statusCode).toBe(200);
        expect(typeof init.body).toBe("string");
        const commandBody: unknown = JSON.parse(init.body as string);
        expect(commandBody).toMatchObject({ roles });
        expect(commandBody).toMatchObject({
            reason: "Settlement saga completed.",
        });
    });

    void test("fails closed when authorizer claims are absent or malformed", async () => {
        const fetchMock = vi.fn();
        const handler = createTestHandler({ fetch: fetchMock });

        const missingClaimsResponse = await handler({});
        const malformedClaimsResponse = await handler(
            httpApiEvent({
                claims: {
                    sub: "not-a-user-id",
                    roles: "Unknown Role",
                },
            }),
        );

        expect(missingClaimsResponse.statusCode).toBe(500);
        expect(parseProblem(missingClaimsResponse).title).toBe(
            "Invalid authorizer context",
        );
        expect(malformedClaimsResponse.statusCode).toBe(500);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    void test.each([
        {
            override: { id: "not-a-report-id" },
            scenario: "invalid path",
        },
        {
            override: { headers: { "idempotency-key": "" } },
            scenario: "missing idempotency key",
        },
        {
            override: {
                headers: { "x-correlation-id": "not-a-correlation-id" },
            },
            scenario: "invalid correlation ID",
        },
        {
            override: { body: { reason: "" } },
            scenario: "invalid body",
        },
    ])("returns 400 for $scenario", async ({ override }) => {
        const fetchMock = vi.fn();
        const handler = createTestHandler({ fetch: fetchMock });

        const response = await handler(httpApiEvent(override));

        expect(response.statusCode).toBe(400);
        expect(parseProblem(response)).toMatchObject({
            title: "Bad Request",
            status: 400,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    void test("returns 400 for malformed JSON bodies", async () => {
        const fetchMock = vi.fn();
        const handler = createTestHandler({ fetch: fetchMock });
        const event = httpApiEvent({});

        const response = await handler({ ...event, body: "not-json" });

        expect(response.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    void test.each([403, 500])(
        "passes through Core Case %s problem responses",
        async (statusCode) => {
            const fetchMock = vi.fn().mockResolvedValue(
                coreCaseResponse(
                    statusCode,
                    {
                        type: "about:blank",
                        title:
                            statusCode === 403 ? "Forbidden" : "Server Error",
                        status: statusCode,
                        detail: "Synthetic Core Case problem.",
                    },
                    { "content-type": "application/problem+json" },
                ),
            );
            const handler = createTestHandler({ fetch: fetchMock });

            const response = await handler(httpApiEvent({}));

            expect(response.statusCode).toBe(statusCode);
            expect(response.headers).toMatchObject({
                "content-type": "application/problem+json",
                "x-correlation-id": "70000000-0000-4000-8000-000000000150",
            });
            expect(JSON.parse(response.body)).toMatchObject({
                status: statusCode,
                detail: "Synthetic Core Case problem.",
            });
        },
    );

    void test("maps network failures to Bad Gateway", async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValue(new Error("synthetic network failure"));
        const handler = createTestHandler({ fetch: fetchMock });

        const response = await handler(httpApiEvent({}));

        expect(response.statusCode).toBe(502);
        expect(parseProblem(response)).toMatchObject({
            title: "Bad Gateway",
            status: 502,
        });
    });

    void test("returns bounded configuration errors without calling Core Case", async () => {
        const fetchMock = vi.fn();
        const handler = createIssuePaymentStubHandler({
            environment: {},
            fetch: fetchMock,
            secretResolver: vi.fn(),
        });

        const response = await handler(httpApiEvent({}));

        expect(response.statusCode).toBe(500);
        expect(parseProblem(response)).toMatchObject({
            title: "Issue Payment configuration unavailable",
            status: 500,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    void test("does not import database or database secret-loading modules", () => {
        const source = readFileSync(
            fileURLToPath(new URL("./issuePaymentStub.ts", import.meta.url)),
            "utf8",
        );

        expect(source).not.toContain("DATABASE_URL");
        expect(source).not.toContain("lambdaSecretsConfig");
        expect(source).not.toContain("db/client");
        expect(source).not.toContain("pg");
        expect(source).not.toContain("drizzle-orm");
    });

    void test("deploy script requires an internal-looking Core Case command URL", () => {
        const source = readFileSync(
            fileURLToPath(
                new URL(
                    "../../../scripts/aws/SCRUM-150/deploy-issue-payment-lambda.sh",
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        expect(source).toContain("require_internal_core_case_base_url");
        expect(source).toContain("ALLOW_PUBLIC_CORE_CASE_INTERNAL_BASE_URL");
        expect(source).toContain(".execute-api.");
        expect(source).toContain("internal-");
        expect(source).toContain("CORE_CASE_INTERNAL_BASE_URL must look like");
    });
});
