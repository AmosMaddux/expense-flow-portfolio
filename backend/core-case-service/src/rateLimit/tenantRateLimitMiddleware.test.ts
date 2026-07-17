import express, { type Express } from "express";
import { type Server } from "node:http";
import { describe, expect, test } from "vitest";

import { problemJsonErrorHandler } from "../errors/problem-json.js";
import {
    createTenantRateLimitMiddleware,
    type TenantRateLimitStore,
} from "./tenantRateLimitMiddleware.js";

function createFakeSharedStore(): TenantRateLimitStore {
    const windows = new Map<
        string,
        { count: number; startedAtMilliseconds: number }
    >();

    return {
        consume(request) {
            const currentTime = request.now.getTime();
            const existing = windows.get(request.tenantId);
            const windowMilliseconds = request.windowSeconds * 1_000;
            const window =
                existing === undefined ||
                existing.startedAtMilliseconds + windowMilliseconds <=
                    currentTime
                    ? { count: 0, startedAtMilliseconds: currentTime }
                    : existing;

            window.count += 1;
            windows.set(request.tenantId, window);
            return Promise.resolve({
                requestCount: window.count,
                retryAfterSeconds: Math.max(
                    1,
                    Math.ceil(
                        (window.startedAtMilliseconds +
                            windowMilliseconds -
                            currentTime) /
                            1_000,
                    ),
                ),
            });
        },
    };
}

function buildTestApp(
    now: () => Date,
    store: TenantRateLimitStore = createFakeSharedStore(),
): Express {
    const app = express();

    app.use((req, _res, next) => {
        req.auth = {
            tenantId: req.header("X-Test-Tenant") ?? "tenant-one",
            userId: "20000000-0000-4000-8000-000000000001",
            roles: ["Employee"],
        };
        next();
    });
    app.use(
        createTenantRateLimitMiddleware(
            { requests: 2, windowSeconds: 10 },
            store,
            now,
        ),
    );
    app.use(express.json());
    app.get("/resource", (_req, res) => {
        res.status(200).json({ ok: true });
    });
    app.use(problemJsonErrorHandler);

    return app;
}

async function requestApp(app: Express, tenantId = "tenant-one") {
    const server = await listenOnEphemeralPort(app);
    const address = server.address();
    if (address === null || typeof address === "string") {
        await closeServer(server);
        throw new Error("Expected test server to listen on a TCP port");
    }

    try {
        return await fetch(`http://127.0.0.1:${address.port}/resource`, {
            headers: { "X-Test-Tenant": tenantId },
        });
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

void describe("tenant rate limit middleware", () => {
    void test("returns 429 beyond the limit and resets after the window", async () => {
        let currentTime = new Date("2026-07-16T12:00:00.000Z");
        const app = buildTestApp(() => currentTime);

        expect((await requestApp(app)).status).toBe(200);
        expect((await requestApp(app)).status).toBe(200);

        const limitedResponse = await requestApp(app);
        expect(limitedResponse.status).toBe(429);
        expect(limitedResponse.headers.get("retry-after")).toBe("10");
        expect(limitedResponse.headers.get("ratelimit-limit")).toBe("2");
        expect(limitedResponse.headers.get("ratelimit-remaining")).toBe("0");
        expect(limitedResponse.headers.get("x-ratelimit-cost")).toBe("1");
        await expect(limitedResponse.json()).resolves.toMatchObject({
            title: "Too Many Requests",
            status: 429,
        });

        currentTime = new Date(currentTime.getTime() + 10_000);
        expect((await requestApp(app)).status).toBe(200);
    });

    void test("tracks tenants independently across middleware instances", async () => {
        const store = createFakeSharedStore();
        const now = () => new Date("2026-07-16T12:00:00.000Z");
        const firstApp = buildTestApp(now, store);
        const secondApp = buildTestApp(now, store);

        expect((await requestApp(firstApp, "tenant-one")).status).toBe(200);
        expect((await requestApp(secondApp, "tenant-one")).status).toBe(200);
        expect((await requestApp(firstApp, "tenant-one")).status).toBe(429);
        expect((await requestApp(secondApp, "tenant-two")).status).toBe(200);
    });
});
