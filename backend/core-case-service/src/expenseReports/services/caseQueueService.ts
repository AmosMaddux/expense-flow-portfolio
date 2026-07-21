import {
    createRedisCaseQueueRollupCache,
    type CaseQueueRollupCache,
} from "../../cache/caseQueueRollupCache.js";
import { getRedisClient } from "../../cache/redisClient.js";
import { db } from "../../db/client.js";
import { readCaseQueueStageRollups } from "../../db/queries/caseQueueRollups.js";
import { transitionExpenseReportStage as transitionPostgresExpenseReportStage } from "../repository/expenseReportRepository.js";
import {
    ReadCaseQueueStageRollupsInboundRequestSchema,
    TransitionExpenseReportStageInboundRequestSchema,
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
    type TransitionExpenseReportStageRequest,
} from "../dto/expenseReportDto.js";

export type CaseQueueRollupStore = {
    readCaseQueueStageRollups(
        params: ReadCaseQueueStageRollupsParams,
    ): Promise<CaseQueueStageRollup[]>;
};

export type CaseQueueTransitionStore = {
    transitionExpenseReportStage(
        request: TransitionExpenseReportStageRequest,
    ): Promise<boolean>;
};

export type CaseQueueServiceDependencies = {
    rollupStore: CaseQueueRollupStore;
    transitionStore?: CaseQueueTransitionStore | undefined;
    rollupCache?: CaseQueueRollupCache | undefined;
};

/**
 * Reads Case Queue rollups from Redis when present, otherwise from Postgres.
 */
export async function readCachedCaseQueueStageRollups(
    request: ReadCaseQueueStageRollupsParams,
    dependencies?: CaseQueueServiceDependencies,
): Promise<CaseQueueStageRollup[]> {
    const parsedRequest =
        ReadCaseQueueStageRollupsInboundRequestSchema.parse(request);
    const resolvedDependencies =
        dependencies ?? (await createDefaultCaseQueueServiceDependencies());
    const cacheRead =
        await resolvedDependencies.rollupCache?.get(parsedRequest);

    if (cacheRead?.kind === "hit") {
        return cacheRead.rollups;
    }

    const rollups =
        await resolvedDependencies.rollupStore.readCaseQueueStageRollups(
            parsedRequest,
        );

    if (cacheRead?.kind === "miss") {
        await resolvedDependencies.rollupCache?.set(cacheRead, rollups);
    }

    return rollups;
}

/**
 * Transitions an Expense Report stage and invalidates tenant rollups.
 */
export async function transitionExpenseReportStage(
    request: TransitionExpenseReportStageRequest,
    dependencies?: CaseQueueServiceDependencies,
): Promise<boolean> {
    const parsedRequest =
        TransitionExpenseReportStageInboundRequestSchema.parse(request);
    const resolvedDependencies =
        dependencies ?? (await createDefaultCaseQueueServiceDependencies());
    const transitionStore = resolvedDependencies.transitionStore;

    if (transitionStore === undefined) {
        throw new Error(
            "Case Queue stage transitions require a transition store.",
        );
    }

    const didTransition =
        await transitionStore.transitionExpenseReportStage(parsedRequest);

    if (didTransition) {
        await resolvedDependencies.rollupCache?.invalidateTenant(
            parsedRequest.tenantId,
        );
    }

    return didTransition;
}

/**
 * Invalidates cached Case Queue rollups for one tenant after stage-changing writes.
 */
export async function invalidateCachedCaseQueueStageRollups(
    tenantId: string,
    dependencies?: CaseQueueServiceDependencies,
): Promise<void> {
    const resolvedDependencies =
        dependencies ?? (await createDefaultCaseQueueServiceDependencies());

    await resolvedDependencies.rollupCache?.invalidateTenant(tenantId);
}
async function createDefaultCaseQueueServiceDependencies(): Promise<CaseQueueServiceDependencies> {
    const redisClient = await getRedisClient();

    return {
        rollupStore: {
            readCaseQueueStageRollups: (params) =>
                readCaseQueueStageRollups(db, params),
        },
        transitionStore: {
            transitionExpenseReportStage: transitionPostgresExpenseReportStage,
        },
        rollupCache:
            redisClient === undefined
                ? undefined
                : createRedisCaseQueueRollupCache(redisClient),
    };
}
