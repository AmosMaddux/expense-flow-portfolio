import { sql, type SQLWrapper } from "drizzle-orm";

import { tenantRateLimitWindow } from "../db/schema/index.js";
import type {
    TenantRateLimitStore,
    TenantRateLimitUsage,
} from "./tenantRateLimitMiddleware.js";

type RateLimitDatabase = {
    execute(query: SQLWrapper | string): PromiseLike<{
        rows: Record<string, unknown>[];
    }>;
};

/**
 * Creates a shared PostgreSQL rate-limit store with atomic tenant counters.
 */
export function createPostgresTenantRateLimitStore(
    db: RateLimitDatabase,
): TenantRateLimitStore {
    return {
        async consume(request): Promise<TenantRateLimitUsage> {
            const result = await db.execute(sql`
                insert into ${tenantRateLimitWindow} (
                    "tenant_id", "window_started_at", "request_count"
                ) values (${request.tenantId}, ${request.now}, 1)
                on conflict ("tenant_id") do update set
                    window_started_at = case
                        when ${tenantRateLimitWindow.windowStartedAt}
                            + make_interval(secs => ${request.windowSeconds}) <= ${request.now}
                        then ${request.now}
                        else ${tenantRateLimitWindow.windowStartedAt}
                    end,
                    request_count = case
                        when ${tenantRateLimitWindow.windowStartedAt}
                            + make_interval(secs => ${request.windowSeconds}) <= ${request.now}
                        then 1
                        else ${tenantRateLimitWindow.requestCount} + 1
                    end
                returning
                    ${tenantRateLimitWindow.requestCount} as "requestCount",
                    greatest(1, ceil(extract(epoch from (
                        ${tenantRateLimitWindow.windowStartedAt}
                        + make_interval(secs => ${request.windowSeconds})
                        - ${request.now}
                    ))))::int as "retryAfterSeconds"
            `);
            const row = result.rows[0];
            if (
                row === undefined ||
                typeof row.requestCount !== "number" ||
                typeof row.retryAfterSeconds !== "number"
            ) {
                throw new Error("Rate limit store returned an invalid result.");
            }

            return {
                requestCount: row.requestCount,
                retryAfterSeconds: row.retryAfterSeconds,
            };
        },
    };
}
