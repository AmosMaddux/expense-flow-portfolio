import { Router } from "express";

import {
    getExpenseReportById,
    postExpenseReportSubmission,
    postExpenseReport,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.post("/expense-reports", postExpenseReport);
expenseReportRouter.post(
    "/expense-reports/:id/submit",
    postExpenseReportSubmission,
);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
