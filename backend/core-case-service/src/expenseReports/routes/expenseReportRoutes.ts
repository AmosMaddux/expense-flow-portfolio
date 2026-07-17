import { Router } from "express";

import {
    getCaseQueueStageRollups,
    getExpenseReportById,
    postExpenseReport,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
expenseReportRouter.post("/expense-reports", postExpenseReport);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
