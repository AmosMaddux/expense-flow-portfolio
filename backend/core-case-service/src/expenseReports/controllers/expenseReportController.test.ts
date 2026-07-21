import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { UnauthorizedError } from "../../errors/problem-json.js";

const readCachedCaseQueueStageRollupsMock = vi.hoisted(() => vi.fn());

vi.mock("../services/caseQueueService.js", () => ({
    readCachedCaseQueueStageRollups: readCachedCaseQueueStageRollupsMock,
}));

import {
    getCaseQueueStageRollups,
    getExpenseReportById,
} from "./expenseReportController.js";

void describe("Expense Report controller authorization", () => {
    beforeEach(() => {
        readCachedCaseQueueStageRollupsMock.mockReset();
    });

    void test("rejects direct handler invocation without auth context", async () => {
        const request = {
            params: { id: "30000000-0000-4000-8000-000000000001" },
        } as unknown as Request;
        const next = vi.fn() as NextFunction;

        await getExpenseReportById(request, {} as Response, next);

        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    void test("uses authenticated tenant for Case Queue rollups instead of query tenant", async () => {
        readCachedCaseQueueStageRollupsMock.mockResolvedValue([]);

        const authenticatedTenantId = "40000000-0000-4000-8000-000000000001";
        const requestedTenantId = "50000000-0000-4000-8000-000000000001";
        const request = {
            auth: {
                tenantId: authenticatedTenantId,
                userId: "60000000-0000-4000-8000-000000000001",
                roles: ["Finance Admin"],
            },
            query: {
                tenantId: requestedTenantId,
                asOfDate: "2026-07-20",
            },
        } as unknown as Request;
        const status = vi.fn().mockReturnThis();
        const response = {
            status,
            json: vi.fn(),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        await getCaseQueueStageRollups(request, response, next);

        expect(readCachedCaseQueueStageRollupsMock).toHaveBeenCalledWith({
            tenantId: authenticatedTenantId,
            asOfDate: "2026-07-20",
        });
        expect(readCachedCaseQueueStageRollupsMock).not.toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: requestedTenantId }),
        );
        expect(status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });
});
