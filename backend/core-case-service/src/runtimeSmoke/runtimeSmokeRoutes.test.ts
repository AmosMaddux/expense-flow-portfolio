import { type Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, test, vi } from "vitest";

import { problemJsonErrorHandler } from "../errors/problem-json.js";
import {
    createRuntimeSmokeRouter,
    isGlCodingRuntimeSmokeEnabled,
    loadRuntimeSmokeConfig,
} from "./runtimeSmokeRoutes.js";

const realFetch = globalThis.fetch;
const runtimeSmokeSecret = "synthetic-runtime-smoke-secret-value";
let activeServer: Server | undefined;

async function requestRuntimeSmoke(
    path: string,
    init?: RequestInit,
): Promise<Response> {
    const app = express();
    app.use("/v1/runtime-smoke", createRuntimeSmokeRouter());
    app.use(problemJsonErrorHandler);

    const server = await new Promise<Server>((resolve, reject) => {
        const candidate = app.listen(0, "127.0.0.1");
        candidate.once("listening", () => {
            resolve(candidate);
        });
        candidate.once("error", reject);
    });
    activeServer = server;

    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Expected test server to listen on a TCP port.");
    }

    return realFetch(`http://127.0.0.1:${address.port}${path}`, init);
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

void describe("runtime smoke routes", () => {
    afterEach(async () => {
        vi.unstubAllGlobals();
        delete process.env.RUNTIME_SMOKE_GL_CODING_ENABLED;
        delete process.env.RUNTIME_SMOKE_SHARED_SECRET;
        await closeActiveServer();
    });

    void test("keeps GL-coding runtime smoke disabled unless explicitly enabled", () => {
        expect(isGlCodingRuntimeSmokeEnabled({})).toBe(false);
        expect(
            isGlCodingRuntimeSmokeEnabled({
                RUNTIME_SMOKE_GL_CODING_ENABLED: "true",
                RUNTIME_SMOKE_SHARED_SECRET: runtimeSmokeSecret,
            }),
        ).toBe(true);
    });

    void test("requires a shared secret when GL-coding runtime smoke is enabled", () => {
        expect(() =>
            loadRuntimeSmokeConfig({
                RUNTIME_SMOKE_GL_CODING_ENABLED: "true",
            }),
        ).toThrow(
            "RUNTIME_SMOKE_SHARED_SECRET is required when GL-coding runtime smoke is enabled.",
        );
    });

    void test("rejects GL-coding smoke requests without the shared token", async () => {
        process.env.RUNTIME_SMOKE_GL_CODING_ENABLED = "true";
        process.env.RUNTIME_SMOKE_SHARED_SECRET = runtimeSmokeSecret;
        const fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetchMock);

        const response = await requestRuntimeSmoke(
            "/v1/runtime-smoke/gl-coding",
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(401);
        expect(body).toMatchObject({
            type: "about:blank",
            title: "Unauthorized",
            status: 401,
            detail: "A valid runtime smoke token is required.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    void test("calls GL-coding health through the configured Core Case client URL", async () => {
        process.env.RUNTIME_SMOKE_GL_CODING_ENABLED = "true";
        process.env.RUNTIME_SMOKE_SHARED_SECRET = runtimeSmokeSecret;
        const fetchMock = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                Response.json({
                    status: "healthy",
                    message: "The service is live and healthy",
                }),
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const response = await requestRuntimeSmoke(
            "/v1/runtime-smoke/gl-coding",
            {
                headers: {
                    "x-runtime-smoke-token": runtimeSmokeSecret,
                },
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(200);
        expect(body).toStrictEqual({
            dependency: "gl-coding",
            status: "healthy",
        });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://gl-coding.example.test/health",
            expect.objectContaining({
                signal: expect.any(AbortSignal) as AbortSignal,
            }),
        );
    });

    void test("returns a bad gateway problem when GL-coding cannot be reached", async () => {
        process.env.RUNTIME_SMOKE_GL_CODING_ENABLED = "true";
        process.env.RUNTIME_SMOKE_SHARED_SECRET = runtimeSmokeSecret;
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(() =>
                Promise.reject(new Error("Synthetic connection failure")),
            ),
        );

        const response = await requestRuntimeSmoke(
            "/v1/runtime-smoke/gl-coding",
            {
                headers: {
                    "x-runtime-smoke-token": runtimeSmokeSecret,
                },
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(502);
        expect(body).toMatchObject({
            type: "about:blank",
            title: "Bad Gateway",
            status: 502,
            detail: "Core Case could not reach the GL-coding health endpoint.",
        });
    });
});
