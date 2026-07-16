import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import { UnauthorizedError } from "../../errors/problem-json.js";
import { getExpenseReportById } from "./expenseReportController.js";

void describe("Expense Report controller authorization", () => {
    void test("rejects direct handler invocation without auth context", async () => {
        const request = {
            params: { id: "30000000-0000-4000-8000-000000000001" },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getExpenseReportById(request, {} as Response, next);

        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
});
