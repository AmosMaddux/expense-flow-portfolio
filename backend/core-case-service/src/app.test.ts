import { type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

import { app } from "./app.js";

let activeServer: Server | undefined;

async function requestApp(path: string): Promise<Response> {
    const server = await listenOnEphemeralPort();
    activeServer = server;
    const address = server.address();

    if (address === null || typeof address === "string") {
        throw new Error("Expected test server to listen on a TCP port");
    }

    return fetch(`http://127.0.0.1:${address.port}${path}`);
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
        const response = await requestApp("/openapi.json");
        const body = (await response.json()) as {
            openapi: string;
            paths: Record<string, unknown>;
        };

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
            "application/json",
        );
        expect(body.openapi).toBe("3.1.0");
        expect(body.paths).toHaveProperty("/expense-reports");
        expect(body.paths).toHaveProperty("/expense-reports/{id}");
    });

    void test("serves Scalar documentation for the OpenAPI document", async () => {
        const response = await requestApp("/docs/");
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(body).toContain("ExpenseFlow Core Case Service API Docs");
        expect(body).toContain("/openapi.json");
    });
});
