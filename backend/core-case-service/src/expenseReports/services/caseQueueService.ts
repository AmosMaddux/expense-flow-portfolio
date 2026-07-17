import {
    createRedisCaseQueueRollupCache,
    type CaseQueueRollupCache,
} from "../../cache/caseQueueRollupCache.js";
import { getRedisClient } from "../../cache/redisClient.js";
import {
    createDynamoExpenseReportCaseStore,
    type ExpenseReportCaseStore,
} from "../../dynamodb/expenseReportCaseStore.js";
import {
    ReadCaseQueueStageRollupsInboundRequestSchema,
    TransitionExpenseReportStageInboundRequestSchema,
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
    type TransitionExpenseReportStageRequest,
} from "../dto/expenseReportDto.js";

export type CaseQueueServiceDependencies = {
    caseStore: ExpenseReportCaseStore;
    rollupCache?: CaseQueueRollupCache | undefined;
};

/**
 * Reads Case Queue rollups from Redis when present, otherwise from DynamoDB.
 */
export async function readCachedCaseQueueStageRollups(
    request: ReadCaseQueueStageRollupsParams,
    dependencies?: CaseQueueServiceDependencies,
): Promise<CaseQueueStageRollup[]> {
    const parsedRequest =
        ReadCaseQueueStageRollupsInboundRequestSchema.parse(request);
    const resolvedDependencies =
        dependencies ?? (await createDefaultCaseQueueServiceDependencies());
    const cachedRollups =
        await resolvedDependencies.rollupCache?.get(parsedRequest);

    if (cachedRollups !== undefined) {
        return cachedRollups;
    }

    const rollups =
        await resolvedDependencies.caseStore.readCaseQueueStageRollups(
            parsedRequest,
        );
    await resolvedDependencies.rollupCache?.set(parsedRequest, rollups);

    return rollups;
}

/**
 * Transitions an Expense Report stage in DynamoDB and invalidates tenant rollups.
 */
export async function transitionExpenseReportStage(
    request: TransitionExpenseReportStageRequest,
    dependencies?: CaseQueueServiceDependencies,
): Promise<boolean> {
    const parsedRequest =
        TransitionExpenseReportStageInboundRequestSchema.parse(request);
    const resolvedDependencies =
        dependencies ?? (await createDefaultCaseQueueServiceDependencies());
    const didTransition =
        await resolvedDependencies.caseStore.transitionExpenseReportStage(
            parsedRequest,
        );

    if (didTransition) {
        await resolvedDependencies.rollupCache?.invalidateTenant(
            parsedRequest.tenantId,
        );
    }

    return didTransition;
}

async function createDefaultCaseQueueServiceDependencies(): Promise<CaseQueueServiceDependencies> {
    const redisClient = await getRedisClient();

    return {
        caseStore: createDynamoExpenseReportCaseStore(),
        rollupCache:
            redisClient === undefined
                ? undefined
                : createRedisCaseQueueRollupCache(redisClient),
    };
}
