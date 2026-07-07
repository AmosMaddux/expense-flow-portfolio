import { app } from "./app.js";
import { applyPendingCoreCaseMigrations } from "./db/migrations.js";

export {
    readCaseQueueReportsForStage,
    readCaseQueueStageRollups,
    type CaseQueueReport,
    type CaseQueueStageRollup,
    type ReadCaseQueueReportsForStageParams,
    type ReadCaseQueueStageRollupsParams,
} from "./db/queries/caseQueueRollups.js";

const PORT = process.env.PORT ?? 3000;

// On start, auto-apply any pending database migrations if the environment variable is set.
async function startCoreCaseService(): Promise<void> {
    if (process.env.AUTO_APPLY_MIGRATIONS === "true") {
        await applyPendingCoreCaseMigrations();
    }

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
