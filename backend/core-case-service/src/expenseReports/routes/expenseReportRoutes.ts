import { Router } from "express";

import {
    getCaseQueueLineItems,
    getCaseQueueStageRollups,
    getExpenseReportAuditEntries,
    getExpenseReportById,
    postExpenseReportFlagClear,
    postExpenseReportLineItemReview,
    postExpenseReportSubmission,
    postExpenseReportTransition,
    postExpenseReport,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/line-items", getCaseQueueLineItems);
expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
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
expenseReportRouter.post(
    "/expense-reports/:id/line-items/:sourceId/review",
    postExpenseReportLineItemReview,
);
expenseReportRouter.get(
    "/expense-reports/:id/audit-entries",
    getExpenseReportAuditEntries,
);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
