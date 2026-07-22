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

type Deferred = {
    promise: Promise<void>;
    resolve(): void;
};

function createDeferred(): Deferred {
    let resolvePromise: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });

    return {
        promise,
        resolve() {
            resolvePromise?.();
        },
    };
}

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
        const currentStage = this.currentStage;

        return Promise.resolve(
            approvedWorkflowStages.map((stage) => ({
                currentStage: stage,
                reportCount: stage === currentStage ? 1 : 0,
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

class DeferredFirstReadExpenseReportCaseStore extends InMemoryExpenseReportCaseStore {
    private shouldDeferNextRollupRead = true;

    public constructor(
        private readonly rollupReadStarted: Deferred,
        private readonly rollupReadMayFinish: Deferred,
    ) {
        super();
    }

    public override async readCaseQueueStageRollups(): Promise<
        CaseQueueStageRollup[]
    > {
        const rollups = await super.readCaseQueueStageRollups();

        if (this.shouldDeferNextRollupRead) {
            this.shouldDeferNextRollupRead = false;
            this.rollupReadStarted.resolve();
            await this.rollupReadMayFinish.promise;
        }

        return rollups;
    }
}

void describe("caseQueueService", () => {
    void test("caches Case Queue rollups with a short TTL", async () => {
        const redisClient = new InMemoryRedisClient();
        const rollupCache = createRedisCaseQueueRollupCache(redisClient, 15);
        const caseStore = new InMemoryExpenseReportCaseStore();
        const dependencies: CaseQueueServiceDependencies = {
            rollupStore: caseStore,
            transitionStore: caseStore,
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
            rollupStore: caseStore,
            transitionStore: caseStore,
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

    void test("does not write stale rollups into a newly invalidated tenant version", async () => {
        const redisClient = new InMemoryRedisClient();
        const rollupCache = createRedisCaseQueueRollupCache(redisClient, 30);
        const rollupReadStarted = createDeferred();
        const rollupReadMayFinish = createDeferred();
        const caseStore = new DeferredFirstReadExpenseReportCaseStore(
            rollupReadStarted,
            rollupReadMayFinish,
        );
        const dependencies: CaseQueueServiceDependencies = {
            rollupStore: caseStore,
            transitionStore: caseStore,
            rollupCache,
        };
        const params = { tenantId, asOfDate };

        const staleReadPromise = readCachedCaseQueueStageRollups(
            params,
            dependencies,
        );
        await rollupReadStarted.promise;

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

        rollupReadMayFinish.resolve();
        const staleRollups = await staleReadPromise;
        const refreshedRollups = await readCachedCaseQueueStageRollups(
            params,
            dependencies,
        );

        expect(didTransition).toBe(true);
        expect(caseStore.rollupReadCount).toBe(2);
        expect(
            staleRollups.find((rollup) => rollup.currentStage === "Drafted"),
        ).toMatchObject({ reportCount: 1 });
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
