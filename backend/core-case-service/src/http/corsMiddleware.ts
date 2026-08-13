import type { RequestHandler } from "express";

import type { CorsConfig } from "../config/corsConfig.js";

export const corsAllowedHeaders = [
    "Authorization",
    "Content-Type",
    "Idempotency-Key",
] as const;
export const corsAllowedMethods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
] as const;
export const corsMaxAgeSeconds = 300;

/** Restricts credentialed browser requests to the configured SPA origin. */
export function createCorsMiddleware(config: CorsConfig): RequestHandler {
    return (request, response, next): void => {
        const requestOrigin = request.header("origin");
        if (requestOrigin === undefined || config.allowedOrigin === undefined) {
            next();
            return;
        }

        response.vary("Origin");
        if (requestOrigin === config.allowedOrigin) {
            response.setHeader("Access-Control-Allow-Origin", requestOrigin);
            response.setHeader("Access-Control-Allow-Credentials", "true");
            response.setHeader(
                "Access-Control-Allow-Methods",
                corsAllowedMethods.join(","),
            );
            response.setHeader(
                "Access-Control-Allow-Headers",
                corsAllowedHeaders.join(","),
            );
            response.setHeader(
                "Access-Control-Max-Age",
                String(corsMaxAgeSeconds),
            );
        }

        if (request.method === "OPTIONS") {
            response.status(204).end();
            return;
        }

        next();
    };
}
