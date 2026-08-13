import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import {
    corsAllowedHeaders,
    corsAllowedMethods,
    corsMaxAgeSeconds,
    createCorsMiddleware,
} from "./corsMiddleware.js";

type CorsResult = {
    headers: Map<string, string>;
    next: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
};

function runPreflight(origin: string): CorsResult {
    const headers = new Map<string, string>();
    const request = {
        header: (name: string) =>
            name.toLowerCase() === "origin" ? origin : undefined,
        method: "OPTIONS",
    } as Request;
    const end = vi.fn();
    const status = vi.fn();
    const response = {
        end,
        setHeader: (name: string, value: string) => {
            headers.set(name.toLowerCase(), value);
        },
        status,
        vary: vi.fn(),
    } as unknown as Response;
    status.mockReturnValue(response);
    const next = vi.fn();

    createCorsMiddleware({
        allowedOrigin: "https://spa.example.test",
    })(request, response, next as NextFunction);

    return {
        headers,
        next,
        status,
        end,
    };
}

void describe("Core Case CORS middleware", () => {
    void test("returns the exact credentialed policy for the SPA", () => {
        const result = runPreflight("https://spa.example.test");

        expect(result.status).toHaveBeenCalledWith(204);
        expect(result.end).toHaveBeenCalledOnce();
        expect(result.next).not.toHaveBeenCalled();
        expect(result.headers.get("access-control-allow-origin")).toBe(
            "https://spa.example.test",
        );
        expect(result.headers.get("access-control-allow-credentials")).toBe(
            "true",
        );
        expect(result.headers.get("access-control-allow-methods")).toBe(
            corsAllowedMethods.join(","),
        );
        expect(result.headers.get("access-control-allow-headers")).toBe(
            corsAllowedHeaders.join(","),
        );
        expect(result.headers.get("access-control-max-age")).toBe(
            String(corsMaxAgeSeconds),
        );
    });

    void test("does not grant CORS to another origin", () => {
        const result = runPreflight("https://untrusted.example.test");

        expect(result.status).toHaveBeenCalledWith(204);
        expect(
            result.headers.get("access-control-allow-origin"),
        ).toBeUndefined();
        expect(
            result.headers.get("access-control-allow-credentials"),
        ).toBeUndefined();
    });
});
