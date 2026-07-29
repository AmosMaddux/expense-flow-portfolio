import { app } from "./app.js";
import { applyPendingCoreCaseMigrations } from "./db/migrations.js";
import { startStageTransitionOutboxDispatcher } from "./events/stageTransitionOutboxDispatcher.js";

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
    type ExpenseReportStageTransitionedCloudEventV1,
    type ExpenseReportStageTransitionedDataV1,
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
        console.log(`Server is running locally at http://localhost:${PORT}`);
        console.log(
            `Health check available at http://localhost:${PORT}/health`,
        );
    });
}

startCoreCaseService().catch((error: unknown) => {
    console.error("Core Case Service failed to start.");
    console.error(
        error instanceof Error ? error.message : "Unknown startup error.",
    );
    process.exit(1);
});
