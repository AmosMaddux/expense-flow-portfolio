import { type Server } from "node:http";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

vi.mock("../../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });

    return {
        db: drizzle(client),
    };
});

import { app } from "../../app.js";

async function requestApp(path: string, init?: RequestInit): Promise<Response> {
    const server = await listenOnEphemeralPort();
    const address = server.address();

    if (address === null || typeof address === "string") {
        await closeServer(server);
        throw new Error("Expected test server to listen on a TCP port");
    }

    try {
        return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    } finally {
        await closeServer(server);
    }
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

async function closeServer(server: Server): Promise<void> {
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

void describe("Expense Report routes", () => {
    void test("creates a Drafted Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000100";
        const owner = "50000000-0000-4000-8000-000000000001";

        const response = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenantId,
                owner,
                dueDate: "2026-07-31",
                priority: "High",
            }),
        });
        const body = (await response.json()) as {
            id?: string;
            tenantId?: string;
            currentStage?: string;
        };

        expect(response.status).toBe(201);
        expect(body.id).toEqual(expect.any(String));
        expect(body.tenantId).toEqual(tenantId);
        expect(body.currentStage).toEqual("Drafted");
    });

    void test("returns Problem+JSON for an invalid create request", async () => {
        const response = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenantId: "tenant-one",
                dueDate: "2026-07-31",
            }),
        });
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Bad Request",
            status: 400,
        });
    });

    void test("reads a tenant-scoped Expense Report", async () => {
        const tenantId = "40000000-0000-4000-8000-000000000101";
        const owner = "50000000-0000-4000-8000-000000000002";

        const createResponse = await requestApp("/expense-reports", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                tenantId,
                owner,
                dueDate: "2026-08-01",
            }),
        });
        const created = (await createResponse.json()) as {
            id: string;
        };

        const readResponse = await requestApp(
            `/expense-reports/${created.id}?tenantId=${tenantId}`,
        );
        const readBody = (await readResponse.json()) as {
            id?: string;
            tenantId?: string;
            currentStage?: string;
        };

        expect(readResponse.status).toBe(200);
        expect(readBody).toMatchObject({
            id: created.id,
            tenantId,
            currentStage: "Drafted",
        });
    });

    void test("returns Problem+JSON when a report is not found", async () => {
        const response = await requestApp(
            "/expense-reports/60000000-0000-4000-8000-000000000001?tenantId=40000000-0000-4000-8000-000000000199",
        );
        const body = (await response.json()) as {
            title?: string;
            status?: number;
        };

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            title: "Not Found",
            status: 404,
        });
    });
});
