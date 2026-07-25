import { Router } from "express";

import {
    getCaseQueueStageRollups,
    getCurrentDraftExpenseReport,
    getDraftExpenseContent,
    getExpenseReportAuditEntries,
    getExpenseReportById,
    getMileageConfig,
    postExpenseReportFlagClear,
    postDraftExpenseContent,
    postExpenseReportSubmission,
    postExpenseReportTransition,
    postExpenseReport,
    postMileageEntry,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
expenseReportRouter.post("/expense-reports", postExpenseReport);
expenseReportRouter.get(
    "/expense-reports/drafts/current",
    getCurrentDraftExpenseReport,
);
expenseReportRouter.get("/expense-reports/config/mileage", getMileageConfig);
expenseReportRouter.post(
    "/expense-reports/:id/mileage-entries",
    postMileageEntry,
);
expenseReportRouter.post(
    "/expense-reports/:id/draft-content",
    postDraftExpenseContent,
);
expenseReportRouter.get(
    "/expense-reports/:id/draft-content",
    getDraftExpenseContent,
);
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
