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
        const firstChunk = chunks[0];
        const secondChunk = chunks[1];
        if (firstChunk === undefined || secondChunk === undefined) {
            throw new Error("Expected at least two chunks.");
        }
        expect(secondChunk.content.startsWith(firstChunk.content.slice(-150))).toBe(
            true,
        );
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

    void test("keeps punctuated all-caps emphasis sentences in the current section", () => {
        const [chunk] = chunkExpensePolicyCorpus({
            tenantId,
            policyText:
                "# Meals\n\nRECEIPTS ARE REQUIRED FOR ALL EXPENSES OVER $25.\n\nNO EXCEPTIONS WILL BE MADE.",
            updatedAt,
        });

        expect(chunk?.section).toBe("Meals");
        expect(chunk?.content).toContain("NO EXCEPTIONS WILL BE MADE.");
    });

    void test("recognizes unpunctuated all-caps headings", () => {
        const chunks = chunkExpensePolicyCorpus({
            tenantId,
            policyText: "MEALS\n\nReceipts are required.",
            updatedAt,
        });

        expect(chunks[0]?.section).toBe("MEALS");
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