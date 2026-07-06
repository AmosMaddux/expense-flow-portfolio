import { app } from "./app.js";

export {
    readCaseQueueStageRollups,
    type CaseQueueStageRollup,
    type ReadCaseQueueStageRollupsParams,
} from "./db/queries/caseQueueRollups.js";

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
    console.log(`Server is running locally at http://localhost:${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
});
