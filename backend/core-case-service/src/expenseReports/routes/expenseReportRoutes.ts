import { Router } from "express";

import {
    getCaseQueueStageRollups,
    getExpenseReportAuditEntries,
    getExpenseReportById,
    postExpenseReportSubmission,
    postExpenseReport,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
expenseReportRouter.post("/expense-reports", postExpenseReport);
expenseReportRouter.post(
    "/expense-reports/:id/submit",
    postExpenseReportSubmission,
);
expenseReportRouter.get(
    "/expense-reports/:id/audit-entries",
    getExpenseReportAuditEntries,
);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
