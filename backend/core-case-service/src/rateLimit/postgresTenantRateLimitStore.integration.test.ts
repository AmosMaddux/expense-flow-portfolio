import express, { type Express } from "express";
import { type Server } from "node:http";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import { createPostgresTenantRateLimitStore } from "./postgresTenantRateLimitStore.js";
import { createTenantRateLimitMiddleware } from "./tenantRateLimitMiddleware.js";

const tenantId = "60000000-0000-4000-8000-000000000111";

function buildTestApp(pool: Pool, now: () => Date): Express {
    const app = express();

    app.use((req, _res, next) => {
        req.auth = {
            tenantId,
            userId: "61000000-0000-4000-8000-000000000111",
            roles: ["Employee"],
        };
        next();
    });
    app.use(
        createTenantRateLimitMiddleware(
            { requests: 2, windowSeconds: 10 },
            createPostgresTenantRateLimitStore(drizzle(pool)),
            now,
        ),
    );
    app.get("/resource", (_req, res) => {
        res.status(200).json({ ok: true });
    });

    return app;
}

async function requestApp(app: Express): Promise<Response> {
    const server = await listenOnEphemeralPort(app);
    const address = server.address();
    if (address === null || typeof address === "string") {
        await closeServer(server);
        throw new Error("Expected test server to listen on a TCP port");
    }

    try {
        return await fetch(`http://127.0.0.1:${address.port}/resource`);
    } finally {
        await closeServer(server);
    }
}

function listenOnEphemeralPort(app: Express): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1");
        server.once("listening", () => resolve(server));
        server.once("error", reject);
    });
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) =>
            error === undefined ? resolve() : reject(error),
        );
    });
}

void describe("PostgreSQL tenant rate limit headers", () => {
    let pool: Pool;

    beforeAll(() => {
        pool = new Pool({ connectionString: getCoreCaseTestDatabaseUrl() });
    });

    afterAll(async () => {
        await pool.end();
    });

    void test("decrements remaining quota and replenishes it after reset", async () => {
        let currentTime = new Date("2026-07-20T12:00:00.000Z");
        const app = buildTestApp(pool, () => currentTime);

        const firstResponse = await requestApp(app);
        expect(firstResponse.status).toBe(200);
        expect(firstResponse.headers.get("ratelimit-remaining")).toBe("1");
        expect(firstResponse.headers.get("x-ratelimit-cost")).toBe("1");

        const secondResponse = await requestApp(app);
        expect(secondResponse.status).toBe(200);
        expect(secondResponse.headers.get("ratelimit-remaining")).toBe("0");
        expect(secondResponse.headers.get("x-ratelimit-cost")).toBe("1");

        currentTime = new Date(currentTime.getTime() + 10_000);

        const resetResponse = await requestApp(app);
        expect(resetResponse.status).toBe(200);
        expect(resetResponse.headers.get("ratelimit-remaining")).toBe("1");
        expect(resetResponse.headers.get("x-ratelimit-cost")).toBe("1");
    });
});
