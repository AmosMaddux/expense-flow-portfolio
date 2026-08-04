import { describe, expect, test, vi } from "vitest";

import { NotFoundError } from "../errors/problem-json.js";
import { PolicyReferenceOutboundResponseSchema } from "../expenseReports/dto/expenseReportDto.js";

import { readPolicyReference } from "./policyReferenceService.js";

void describe("readPolicyReference", () => {
    void test("returns the tenant policy through the outbound response schema", async () => {
        const updatedAt = new Date("2026-07-24T12:00:00.000Z");
        const policyText =
            "  Synthetic reimbursability policy.\n\n    Preserve indentation.\n";
        const repository = {
            findTenantExpensePolicy: vi.fn().mockResolvedValue({
                policyText,
                updatedAt,
            }),
        };

        const response = await readPolicyReference(
            { tenantId: "40000000-0000-4000-8000-000000000921" },
            repository,
        );

        expect(repository.findTenantExpensePolicy).toHaveBeenCalledWith(
            "40000000-0000-4000-8000-000000000921",
        );
        expect(PolicyReferenceOutboundResponseSchema.parse(response)).toEqual({
            policyText,
            updatedAt: "2026-07-24T12:00:00.000Z",
        });
    });

    void test("rejects blank policy text without trimming valid content", () => {
        expect(() =>
            PolicyReferenceOutboundResponseSchema.parse({
                policyText: "   \n\t",
                updatedAt: "2026-07-24T12:00:00.000Z",
            }),
        ).toThrow("Policy text must not be blank.");
    });

    void test("returns not found when the authenticated tenant has no policy", async () => {
        const repository = {
            findTenantExpensePolicy: vi.fn().mockResolvedValue(null),
        };

        await expect(
            readPolicyReference(
                { tenantId: "40000000-0000-4000-8000-000000000922" },
                repository,
            ),
        ).rejects.toBeInstanceOf(NotFoundError);
    });
});
