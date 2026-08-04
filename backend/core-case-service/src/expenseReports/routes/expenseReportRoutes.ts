import { Router, raw } from "express";

import { getPolicyReference } from "../../policyReference/policyReferenceController.js";
import {
    deleteDraftLineItemEntry,
    deleteDraftMileageEntryRecord,
    getAllTransactions,
    getCaseQueueLineItems,
    getCaseQueueStageRollups,
    getCurrentDraftExpenseReport,
    getDraftExpenseContent,
    getExpenseReportAuditEntries,
    getExpenseReportById,
    getExpenseReportComments,
    getExpenseReportReviewDetail,
    getFinanceDashboardTrend,
    getMileageConfig,
    patchExpenseReportSourceDeductibility,
    getMySubmissionDetail,
    getMySubmissions,
    postExpenseReportFlagClear,
    postExpenseReportLineItemReview,
    postExpenseReportSourceReview,
    postExpenseReportSettlement,
    postDraftExpenseContent,
    postExpenseReportSubmission,
    postExpenseReportTransition,
    postExpenseReport,
    postExpenseReportComment,
    postMileageEntry,
    patchDraftLineItem,
    patchDraftMileageEntry,
    putReceiptUpload,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.get("/case-queue/line-items", getCaseQueueLineItems);
expenseReportRouter.get("/case-queue/rollups", getCaseQueueStageRollups);
expenseReportRouter.get("/finance-dashboard/trends", getFinanceDashboardTrend);
expenseReportRouter.get("/policy-reference", getPolicyReference);
expenseReportRouter.get("/transactions", getAllTransactions);
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
expenseReportRouter.patch(
    "/expense-reports/:id/line-items/:sourceId",
    patchDraftLineItem,
);
expenseReportRouter.delete(
    "/expense-reports/:id/line-items/:sourceId",
    deleteDraftLineItemEntry,
);
expenseReportRouter.patch(
    "/expense-reports/:id/mileage-entries/:sourceId",
    patchDraftMileageEntry,
);
expenseReportRouter.delete(
    "/expense-reports/:id/mileage-entries/:sourceId",
    deleteDraftMileageEntryRecord,
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
    "/expense-reports/:id/settlement",
    postExpenseReportSettlement,
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
expenseReportRouter.patch(
    "/expense-reports/:id/sources/:sourceType/:sourceId/deductibility",
    patchExpenseReportSourceDeductibility,
);
expenseReportRouter.get(
    "/expense-reports/:id/audit-entries",
    getExpenseReportAuditEntries,
);
expenseReportRouter.get(
    "/expense-reports/:id/comments",
    getExpenseReportComments,
);
expenseReportRouter.post(
    "/expense-reports/:id/comments",
    postExpenseReportComment,
);
expenseReportRouter.get(
    "/expense-reports/:id/review-detail",
    getExpenseReportReviewDetail,
);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
