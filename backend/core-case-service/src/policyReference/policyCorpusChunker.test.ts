import { describe, expect, test } from "vitest";

import { chunkExpensePolicyCorpus } from "./policyCorpusChunker.js";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const updatedAt = new Date("2026-08-20T12:00:00.000Z");

void describe("chunkExpensePolicyCorpus", () => {
    void test("splits policy text into ordered, sectioned chunks", () => {
        const chunks = chunkExpensePolicyCorpus({
            tenantId,
            policyText: `# Meals\n\n${"Meals require a business purpose and a receipt. ".repeat(30)}\n\n2. Travel\n\nTravel must use reasonable economy options.`,
            updatedAt,
        });

        expect(chunks.length).toBeGreaterThan(2);
        expect(chunks[0]?.section).toBe("Meals");
        expect(chunks.at(-1)?.section).toBe("Travel");
        expect(chunks.every((chunk) => chunk.content.trim().length > 0)).toBe(
            true,
        );
        expect(
            chunks[1]?.content.startsWith(chunks[0]?.content.slice(-150)),
        ).toBe(true);
        expect(chunks.map((chunk) => chunk.chunkIndex)).toStrictEqual(
            chunks.map((_, index) => index),
        );
    });

    void test("uses General when no heading is present", () => {
        const [chunk] = chunkExpensePolicyCorpus({
            tenantId,
            policyText: "Receipts are required for reimbursable expenses.",
            updatedAt,
        });

        expect(chunk?.section).toBe("General");
    });

    void test("produces stable hashes for the same normalized input", () => {
        const request = {
            tenantId,
            policyText: "# Meals\r\n\r\nReceipts are required.",
            updatedAt,
        };

        expect(chunkExpensePolicyCorpus(request)).toStrictEqual(
            chunkExpensePolicyCorpus({
                ...request,
                policyText: "# Meals\n\nReceipts are required.",
            }),
        );
    });
});
