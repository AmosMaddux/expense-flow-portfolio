import { type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { Express } from "express";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { syntheticRsaPrivateKeyBase64 } from "./testSupport/jwtTestKeys.js";

let app: Express;
let activeServer: Server | undefined;

async function requestApp(path: string, init?: RequestInit): Promise<Response> {
    const server = await listenOnEphemeralPort();
    activeServer = server;
    const address = server.address();

    if (address === null || typeof address === "string") {
        throw new Error("Expected test server to listen on a TCP port");
    }

    return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

function listenOnEphemeralPort(): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1");
        server.once("listening", () => {
            resolve(server);
        });
        server.once("error", reject);
    });
}

async function closeActiveServer(): Promise<void> {
    const server = activeServer;
    activeServer = undefined;

    if (server === undefined) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolve();
                return;
            }

            reject(error);
        });
    });
}

void describe("app", () => {
    beforeAll(async () => {
        process.env.AUTH_JWT_PRIVATE_KEY_BASE64 = syntheticRsaPrivateKeyBase64;
        process.env.AUTH_JWT_KEY_ID = "synthetic-key-v1";
        process.env.MFA_TOTP_SECRET_ENCRYPTION_KEY = Buffer.alloc(
            32,
            1,
        ).toString("base64");
        process.env.MFA_TOTP_SECRET_KEY_VERSION = "synthetic-v1";
        app = (await import("./app.js")).app;
    });

    afterEach(async () => {
        await closeActiveServer();
    });

    void test("serves the generated OpenAPI document", async () => {
        const response = await requestApp("/v1/openapi.json");
        const body = (await response.json()) as {
            openapi: string;
            paths: Record<string, unknown>;
        };

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
            "application/json",
        );
        expect(body.openapi).toBe("3.1.0");
        expect(body.paths).toHaveProperty("/v1/auth/login");
        expect(body.paths).toHaveProperty("/v1/auth/mfa/enroll");
        expect(body.paths).toHaveProperty("/v1/expense-reports");
        expect(body.paths).toHaveProperty("/v1/expense-reports/{id}");
        expect(body.paths).toHaveProperty("/v1/expense-reports/{id}/submit");
        expect(body.paths).toHaveProperty(
            "/v1/expense-reports/{id}/audit-entries",
        );
    });

    void test("rejects unsupported SSO, SAML, and OIDC auth paths", async () => {
        for (const path of [
            "/auth/sso/login",
            "/auth/saml/login",
            "/auth/oidc/login",
        ]) {
            const response = await requestApp(path, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    tenantId: "00000000-0000-4000-8000-000000000605",
                    email: "employee@example.invalid",
                }),
            });
            const body = await response.text();

            expect(response.status).toBe(404);
            expect(body).not.toContain("employee@example.invalid");
        }
    });
    void test("serves Scalar documentation for the OpenAPI document", async () => {
        const response = await requestApp("/v1/docs/");
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(body).toContain("ExpenseFlow Core Case Service v1 API Docs");
        expect(body).toContain("/v1/openapi.json");
    });

    void test.each([
        ["POST", "/expense-reports"],
        ["POST", "/auth/login"],
        ["POST", "/auth/mfa/enroll"],
        ["GET", "/openapi.json"],
        ["GET", "/docs/"],
        [
            "GET",
            "/expense-reports/60000000-0000-4000-8000-000000000001/audit-entries",
        ],
    ])(
        "does not expose %s %s without a version prefix",
        async (method, path) => {
            const response = await requestApp(path, { method });

            expect(response.status).toBe(404);
        },
    );

    void test.each(["/v1/auth/login", "/v1/auth/mfa/enroll"])(
        "mounts the versioned auth route at %s",
        async (path) => {
            const response = await requestApp(path, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            });

            expect(response.status).toBe(400);
            expect(response.headers.get("content-type")).toContain(
                "application/problem+json",
            );
        },
    );

    void test("contract: /v1 responses match the published schema", async () => {
        const publishedDocumentUrl = new URL(
            "../../../docs/openapi/core-case-service.openapi.json",
            import.meta.url,
        );
        const publishedDocument = JSON.parse(
            await readFile(publishedDocumentUrl, "utf8"),
        ) as {
            components?: {
                schemas?: Record<string, unknown>;
            };
            paths?: Record<
                string,
                {
                    get?: {
                        responses?: Record<
                            string,
                            {
                                content?: Record<
                                    string,
                                    { schema?: { $ref?: string } }
                                >;
                            }
                        >;
                    };
                }
            >;
        };
        const response = await requestApp(
            "/v1/expense-reports/not-a-report-id",
        );
        const body: unknown = await response.json();
        const publishedSchema =
            publishedDocument.paths?.["/v1/expense-reports/{id}"]?.get
                ?.responses?.["401"]?.content?.["application/problem+json"]
                ?.schema;

        expect(response.status).toBe(401);
        expect(publishedSchema?.$ref).toBe("#/components/schemas/ProblemJson");
        const problemJsonSchema = z.fromJSONSchema(
            publishedDocument.components?.schemas?.ProblemJson as Parameters<
                typeof z.fromJSONSchema
            >[0],
        );
        expect(problemJsonSchema.safeParse(body).success).toBe(true);
    });
});
