import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

const answerAssistQuestionMock = vi.hoisted(() => vi.fn());

vi.mock("./assistService.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./assistService.js")>()),
    answerAssistQuestion: answerAssistQuestionMock,
}));

import { postAssist } from "./assistController.js";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const reportId = "40000000-0000-4000-8000-000000000001";

function response(): { res: Response; body: unknown; status: number } {
    const result = { body: undefined as unknown, status: 0 };
    const res = {
        json: vi.fn((body: unknown) => { result.body = body; }),
        status: vi.fn((status: number) => { result.status = status; return res; }),
    } as unknown as Response;
    return { res, get body() { return result.body; }, get status() { return result.status; } };
}

void describe("postAssist", () => {
    void test("uses authenticated tenant scope for an internal manager", async () => {
        answerAssistQuestionMock.mockResolvedValue({ answer: "Policy answer" });
        const output = response();
        const next = vi.fn() as NextFunction;
        await postAssist({
            auth: { tenantId, userId: reportId, roles: ["Department Manager"] },
            body: { question: "Is this reimbursable?", caseContext: { expenseReportId: reportId } },
        } as unknown as Request, output.res, next);

        expect(answerAssistQuestionMock).toHaveBeenCalledWith({
            tenantId,
            question: "Is this reimbursable?",
            caseContext: { expenseReportId: reportId },
        });
        expect(output.status).toBe(200);
        expect(next).not.toHaveBeenCalled();
    });

    void test("rejects unauthenticated, unauthorized, and malformed requests", async () => {
        for (const req of [
            { body: {} },
            { auth: { tenantId, userId: reportId, roles: ["Employee"] }, body: {} },
            { auth: { tenantId, userId: reportId, roles: ["Department Manager"] }, body: { question: "", caseContext: {} } },
        ]) {
            const output = response();
            const next = vi.fn() as NextFunction;
            await postAssist(req as unknown as Request, output.res, next);
            expect(next).toHaveBeenCalledTimes(1);
        }
        expect(answerAssistQuestionMock).toHaveBeenCalledTimes(1);
    });
});