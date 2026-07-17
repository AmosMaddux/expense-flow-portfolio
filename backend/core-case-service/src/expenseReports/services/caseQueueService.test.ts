import { describe, expect, test } from "vitest";

import { createRedisCaseQueueRollupCache } from "../../cache/caseQueueRollupCache.js";
import { approvedWorkflowStages } from "../../db/schema/index.js";
import type {
    CaseQueueStageRollup,
    TransitionExpenseReportStageRequest,
} from "../dto/expenseReportDto.js";
import {
    readCachedCaseQueueStageRollups,
    transitionExpenseReportStage,
    type CaseQueueServiceDependencies,
} from "./caseQueueService.js";

const tenantId = "10000000-0000-4000-8000-000000000100";
const expenseReportId = "20000000-0000-4000-8000-000000000200";
const actor = "30000000-0000-4000-8000-000000000300";
const asOfDate = "2026-07-17";

class InMemoryRedisClient {
    public readonly ttlByKey = new Map<string, number>();
    private readonly values = new Map<string, string>();

    public get(key: string): Promise<string | null> {
        return Promise.resolve(this.values.get(key) ?? null);
    }

    public set(
        key: string,
        value: string,
        options: { EX: number },
    ): Promise<void> {
        this.values.set(key, value);
        this.ttlByKey.set(key, options.EX);

        return Promise.resolve();
    }

    public incr(key: string): Promise<number> {
        const nextValue = Number(this.values.get(key) ?? "0") + 1;
        this.values.set(key, String(nextValue));

        return Promise.resolve(nextValue);
    }
}

class InMemoryExpenseReportCaseStore {
    public rollupReadCount = 0;
    private currentStage: CaseQueueStageRollup["currentStage"] = "Drafted";

    public readCaseQueueStageRollups(): Promise<CaseQueueStageRollup[]> {
        this.rollupReadCount += 1;

        return Promise.resolve(
            approvedWorkflowStages.map((stage) => ({
                currentStage: stage,
                reportCount: stage === this.currentStage ? 1 : 0,
                overdueCount: 0,
            })),
        );
    }

    public transitionExpenseReportStage(
        request: TransitionExpenseReportStageRequest,
    ): Promise<boolean> {
        if (request.fromStage !== this.currentStage) {
            return Promise.resolve(false);
        }

        this.currentStage = request.toStage;

        return Promise.resolve(true);
    }
}

void describe("caseQueueService", () => {
    void test("caches Case Queue rollups with a short TTL", async () => {
        const redisClient = new InMemoryRedisClient();
        const rollupCache = createRedisCaseQueueRollupCache(redisClient, 15);
        const caseStore = new InMemoryExpenseReportCaseStore();
        const dependencies: CaseQueueServiceDependencies = {
            caseStore,
            rollupCache,
        };
        const params = { tenantId, asOfDate };

        await readCachedCaseQueueStageRollups(params, dependencies);
        await readCachedCaseQueueStageRollups(params, dependencies);

        expect(caseStore.rollupReadCount).toBe(1);
        expect([...redisClient.ttlByKey.values()]).toContain(15);
    });

    void test("invalidates a stale tenant rollup cache after a stage transition", async () => {
        const redisClient = new InMemoryRedisClient();
        const rollupCache = createRedisCaseQueueRollupCache(redisClient, 30);
        const caseStore = new InMemoryExpenseReportCaseStore();
        const dependencies: CaseQueueServiceDependencies = {
            caseStore,
            rollupCache,
        };
        const params = { tenantId, asOfDate };

        await readCachedCaseQueueStageRollups(params, dependencies);

        const didTransition = await transitionExpenseReportStage(
            {
                tenantId,
                id: expenseReportId,
                actor,
                fromStage: "Drafted",
                toStage: "Submitted",
                reason: "employee_submitted",
            },
            dependencies,
        );
        const refreshedRollups = await readCachedCaseQueueStageRollups(
            params,
            dependencies,
        );

        expect(didTransition).toBe(true);
        expect(caseStore.rollupReadCount).toBe(2);
        expect(
            refreshedRollups.find(
                (rollup) => rollup.currentStage === "Drafted",
            ),
        ).toMatchObject({ reportCount: 0 });
        expect(
            refreshedRollups.find(
                (rollup) => rollup.currentStage === "Submitted",
            ),
        ).toMatchObject({ reportCount: 1 });
    });
});
