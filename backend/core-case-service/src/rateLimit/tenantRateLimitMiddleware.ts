import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { RateLimitConfig } from "../config/rateLimitConfig.js";
import {
    RateLimitExceededError,
    UnauthorizedError,
} from "../errors/problem-json.js";

type TenantWindow = {
    requestCount: number;
    resetsAtMilliseconds: number;
};

/**
 * Enforces a fixed-window request limit using the authenticated tenant identity.
 */
export function createTenantRateLimitMiddleware(
    config: RateLimitConfig,
    now: () => number = Date.now,
): RequestHandler {
    const tenantWindows = new Map<string, TenantWindow>();
    const windowMilliseconds = config.windowSeconds * 1_000;

    return (req: Request, res: Response, next: NextFunction): void => {
        const tenantId = req.auth?.tenantId;
        if (tenantId === undefined) {
            next(new UnauthorizedError());
            return;
        }

        const currentTime = now();
        const existingWindow = tenantWindows.get(tenantId);
        const tenantWindow =
            existingWindow === undefined ||
            currentTime >= existingWindow.resetsAtMilliseconds
                ? {
                      requestCount: 0,
                      resetsAtMilliseconds: currentTime + windowMilliseconds,
                  }
                : existingWindow;

        tenantWindow.requestCount += 1;
        tenantWindows.set(tenantId, tenantWindow);

        const retryAfterSeconds = Math.max(
            1,
            Math.ceil(
                (tenantWindow.resetsAtMilliseconds - currentTime) / 1_000,
            ),
        );
        const remaining = Math.max(
            0,
            config.requests - tenantWindow.requestCount,
        );

        res.set({
            "RateLimit-Limit": String(config.requests),
            "RateLimit-Remaining": String(remaining),
            "RateLimit-Reset": String(retryAfterSeconds),
            "X-RateLimit-Cost": "1",
        });

        if (tenantWindow.requestCount > config.requests) {
            next(new RateLimitExceededError(retryAfterSeconds));
            return;
        }

        next();
    };
}
