import { type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";

import { app } from "./app.js";

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
