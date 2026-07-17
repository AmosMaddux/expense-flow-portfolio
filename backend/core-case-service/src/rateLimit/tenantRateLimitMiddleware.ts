import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { RateLimitConfig } from "../config/rateLimitConfig.js";
import {
    RateLimitExceededError,
    UnauthorizedError,
} from "../errors/problem-json.js";

export type TenantRateLimitUsage = {
    requestCount: number;
    retryAfterSeconds: number;
};

export type TenantRateLimitStore = {
    consume(request: {
        tenantId: string;
        windowSeconds: number;
        now: Date;
    }): Promise<TenantRateLimitUsage>;
};

/**
 * Enforces a fixed-window request limit using the authenticated tenant identity.
 */
export function createTenantRateLimitMiddleware(
    config: RateLimitConfig,
    store: TenantRateLimitStore,
    now: () => Date = () => new Date(),
): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        const tenantId = req.auth?.tenantId;
        if (tenantId === undefined) {
            next(new UnauthorizedError());
            return;
        }

        try {
            const usage = await store.consume({
                tenantId,
                windowSeconds: config.windowSeconds,
                now: now(),
            });
            const remaining = Math.max(0, config.requests - usage.requestCount);

            res.set({
                "RateLimit-Limit": String(config.requests),
                "RateLimit-Remaining": String(remaining),
                "RateLimit-Reset": String(usage.retryAfterSeconds),
                "X-RateLimit-Cost": "1",
            });

            if (usage.requestCount > config.requests) {
                next(new RateLimitExceededError(usage.retryAfterSeconds));
                return;
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}
