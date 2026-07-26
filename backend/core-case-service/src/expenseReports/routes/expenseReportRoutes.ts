import { Router } from "express";

import {
    getCaseQueueStageRollups,
    getExpenseReportAuditEntries,
    getExpenseReportById,
    getFinanceDashboardTrend,
    postExpenseReportFlagClear,
    postExpenseReportSubmission,
    postExpenseReportTransition,
    postExpenseReport,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
expenseReportRouter.get("/finance-dashboard/trends", getFinanceDashboardTrend);
expenseReportRouter.post("/expense-reports", postExpenseReport);
expenseReportRouter.post(
    "/expense-reports/:id/submit",
    postExpenseReportSubmission,
);
expenseReportRouter.post(
    "/expense-reports/:id/transitions",
    postExpenseReportTransition,
);
expenseReportRouter.post(
    "/expense-reports/:id/flags/clear",
    postExpenseReportFlagClear,
);
expenseReportRouter.get(
    "/expense-reports/:id/audit-entries",
    getExpenseReportAuditEntries,
);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
