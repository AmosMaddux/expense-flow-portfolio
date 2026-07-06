import express, { type Request, type Response } from "express";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

export {
    readCaseQueueReportsForStage,
    readCaseQueueStageRollups,
    type CaseQueueReport,
    type CaseQueueStageRollup,
    type ReadCaseQueueReportsForStageParams,
    type ReadCaseQueueStageRollupsParams,
} from "./db/queries/caseQueueRollups.js";

/**
 * Returns process health information for local and deployment smoke checks.
 */
app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
        status: "UP",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

app.listen(PORT, () => {
    console.log(`Server is running locally at http://localhost:${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
});
