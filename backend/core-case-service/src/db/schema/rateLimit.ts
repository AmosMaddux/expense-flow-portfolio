import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenantRateLimitWindow = pgTable(
    "tenant_rate_limit_window",
    {
        tenantId: uuid("tenant_id").primaryKey(),
        windowStartedAt: timestamp("window_started_at", {
            withTimezone: true,
        }).notNull(),
        requestCount: integer("request_count").notNull(),
    },
    (table) => [
        check(
            "tenant_rate_limit_window_request_count_positive_check",
            sql`${table.requestCount} > 0`,
        ),
    ],
);
