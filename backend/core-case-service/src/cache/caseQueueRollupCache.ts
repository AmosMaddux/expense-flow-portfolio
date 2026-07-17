import { z } from "zod";

import {
    CaseQueueStageRollupListSchema,
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
} from "../expenseReports/dto/expenseReportDto.js";

export type CaseQueueRollupCacheClient = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options: { EX: number }): Promise<unknown>;
    incr(key: string): Promise<number>;
};

export type CaseQueueRollupCache = {
    get(
        params: ReadCaseQueueStageRollupsParams,
    ): Promise<CaseQueueStageRollup[] | undefined>;
    set(
        params: ReadCaseQueueStageRollupsParams,
        rollups: CaseQueueStageRollup[],
    ): Promise<void>;
    invalidateTenant(tenantId: string): Promise<void>;
};

const cacheKeyInputSchema = z.object({
    tenantId: z.uuid(),
    asOfDate: z.iso.date(),
});

/**
 * Builds a Redis-backed Case Queue rollup cache with tenant-version invalidation.
 */
export function createRedisCaseQueueRollupCache(
    client: CaseQueueRollupCacheClient,
    ttlSeconds = readCaseQueueRollupTtlSeconds(),
): CaseQueueRollupCache {
    return {
        async get(params) {
            try {
                const cacheKey = await buildRollupCacheKey(client, params);
                const cachedValue = await client.get(cacheKey);

                if (cachedValue === null) {
                    return undefined;
                }

                return CaseQueueStageRollupListSchema.parse(
                    JSON.parse(cachedValue),
                );
            } catch {
                return undefined;
            }
        },
        async set(params, rollups) {
            try {
                const cacheKey = await buildRollupCacheKey(client, params);
                await client.set(cacheKey, JSON.stringify(rollups), {
                    EX: ttlSeconds,
                });
            } catch {
                return;
            }
        },
        async invalidateTenant(tenantId) {
            try {
                await client.incr(buildTenantVersionKey(tenantId));
            } catch {
                return;
            }
        },
    };
}

/**
 * Reads the configured Case Queue rollup cache TTL in seconds.
 */
export function readCaseQueueRollupTtlSeconds(): number {
    const configuredTtl = Number(process.env.CASE_QUEUE_ROLLUP_TTL_SECONDS);

    if (Number.isInteger(configuredTtl) && configuredTtl > 0) {
        return configuredTtl;
    }

    return 30;
}

async function buildRollupCacheKey(
    client: CaseQueueRollupCacheClient,
    params: ReadCaseQueueStageRollupsParams,
): Promise<string> {
    const parsedParams = cacheKeyInputSchema.parse(params);
    const version = await readTenantVersion(client, parsedParams.tenantId);

    return [
        "case-queue-rollup",
        parsedParams.tenantId,
        `v${version}`,
        parsedParams.asOfDate,
    ].join(":");
}

async function readTenantVersion(
    client: CaseQueueRollupCacheClient,
    tenantId: string,
): Promise<string> {
    const version = await client.get(buildTenantVersionKey(tenantId));

    return version ?? "0";
}

function buildTenantVersionKey(tenantId: string): string {
    return ["case-queue-rollup-version", tenantId].join(":");
}
