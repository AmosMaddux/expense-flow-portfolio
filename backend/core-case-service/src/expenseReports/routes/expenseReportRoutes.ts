import { Router, raw } from "express";

import {
    getCaseQueueLineItems,
    getCaseQueueStageRollups,
    getCurrentDraftExpenseReport,
    getDraftExpenseContent,
    getExpenseReportAuditEntries,
    getExpenseReportById,
    getMileageConfig,
    getMySubmissionDetail,
    getMySubmissions,
    postExpenseReportFlagClear,
    postExpenseReportLineItemReview,
    postExpenseReportSourceReview,
    postDraftExpenseContent,
    postExpenseReportSubmission,
    postExpenseReportTransition,
    postExpenseReport,
    postMileageEntry,
    putReceiptUpload,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/line-items", getCaseQueueLineItems);
expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
expenseReportRouter.get("/expense-reports/my-submissions", getMySubmissions);
expenseReportRouter.get(
    "/expense-reports/:id/submission-detail",
    getMySubmissionDetail,
);
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
expenseReportRouter.put(
    "/expense-reports/:id/receipt-uploads/:uploadId",
    raw({ limit: 10 * 1024 * 1024, type: () => true }),
    putReceiptUpload,
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
expenseReportRouter.post(
    "/expense-reports/:id/line-items/:sourceId/review",
    postExpenseReportLineItemReview,
);
expenseReportRouter.post(
    "/expense-reports/:id/sources/:sourceType/:sourceId/review",
    postExpenseReportSourceReview,
);
expenseReportRouter.get(
    "/expense-reports/:id/audit-entries",
    getExpenseReportAuditEntries,
);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
