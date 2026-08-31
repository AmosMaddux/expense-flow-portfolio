import { app } from "./app.js";
import { applyPendingCoreCaseMigrations } from "./db/migrations.js";
import { startStageTransitionOutboxDispatcher } from "./events/stageTransitionOutboxDispatcher.js";
import { logCoreCaseInfo } from "./logging/coreCaseLogger.js";

export {
    readCaseQueueReportsForStage,
    readCaseQueueStageRollups,
    type CaseQueueReport,
    type ReadCaseQueueReportsForStageParams,
} from "./db/queries/caseQueueRollups.js";
export {
    readAllTransactions,
    type ExpenseReportStage as AllTransactionsExpenseReportStage,
} from "./db/queries/allTransactions.js";
export {
    readCachedCaseQueueStageRollups,
    transitionExpenseReportStage,
    type CaseQueueServiceDependencies,
} from "./expenseReports/services/caseQueueService.js";
export {
    EXPENSE_REPORT_STAGE_TRANSITIONED_DATA_SCHEMA,
    EXPENSE_REPORT_STAGE_TRANSITIONED_EVENT_TYPE,
    ExpenseReportStageTransitionedCloudEventV1Schema,
    ExpenseReportStageTransitionedDataV1Schema,
    pollStageTransitionQueueOnce,
    processStageTransitionEvent,
    processStageTransitionEventBody,
    runStageTransitionSqsConsumer,
    type ExpenseReportStageTransitionedCloudEventV1,
    type ExpenseReportStageTransitionedDataV1,
    type StageTransitionSqsPollResult,
} from "./events/index.js";
export {
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
    type TransitionExpenseReportStageRequest,
} from "./expenseReports/dto/expenseReportDto.js";

const PORT = process.env.PORT ?? 3000;

// On start, auto-apply any pending database migrations if the environment variable is set.
async function startCoreCaseService(): Promise<void> {
    if (process.env.AUTO_APPLY_MIGRATIONS === "true") {
        await applyPendingCoreCaseMigrations();
    }

    startStageTransitionOutboxDispatcher();
    app.listen(PORT, () => {
        logCoreCaseInfo({
            eventType: "service_startup",
            message: "Core Case Service is running locally.",
            port: PORT,
            service: "core-case-service",
        });
    });
}

startCoreCaseService().catch((error: unknown) => {
    logCoreCaseInfo({
        eventType: "service_startup_failed",
        error:
            error instanceof Error ? error.message : "Unknown startup error.",
        service: "core-case-service",
    });
    process.exit(1);
});
