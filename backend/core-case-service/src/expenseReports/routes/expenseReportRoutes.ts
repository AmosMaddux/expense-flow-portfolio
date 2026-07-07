import { Router } from "express";

import {
    getExpenseReportById,
    postExpenseReport,
} from "../controllers/expenseReportController.js";

export const expenseReportRouter = Router();

expenseReportRouter.post("/expense-reports", postExpenseReport);
expenseReportRouter.get("/expense-reports/:id", getExpenseReportById);
