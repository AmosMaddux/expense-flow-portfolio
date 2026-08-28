import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const receiptFixtureDirectory = new URL(
    "../../../../scripts/fixtures/receipts/",
    import.meta.url,
);

const demoTransactionsSeedSqlUrl = new URL(
    "../../../../scripts/seed-demo-transactions.sql",
    import.meta.url,
);

const receiptFixtures = [
    {
        filename: "synthetic-hotel-receipt.pdf",
        contentType: "application/pdf",
        magicBytes: Buffer.from("%PDF"),
    },
    {
        filename: "synthetic-rail-receipt.png",
        contentType: "image/png",
        magicBytes: Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
    },
    {
        filename: "synthetic-unlinked-receipt.pdf",
        contentType: "application/pdf",
        magicBytes: Buffer.from("%PDF"),
    },
] as const;

void describe("synthetic local demo receipt fixtures", () => {
    for (const fixture of receiptFixtures) {
        void test(`${fixture.filename} is explicit synthetic receipt data`, async () => {
            const bytes = await readFile(
                new URL(fixture.filename, receiptFixtureDirectory),
            );

            expect(bytes.subarray(0, fixture.magicBytes.length)).toStrictEqual(
                fixture.magicBytes,
            );
            expect(bytes.byteLength).toBeGreaterThan(0);
            expect(bytes.byteLength).toBeLessThan(10 * 1024);
            expect(bytes.toString("latin1")).toContain(
                "Synthetic Receipt Fixture",
            );
            expect(bytes.toString("latin1")).toContain("Not a real receipt");
        });
    }

    void test("uses only receipt MIME types supported by the upload contract", () => {
        expect(receiptFixtures.map((fixture) => fixture.contentType)).toEqual([
            "application/pdf",
            "image/png",
            "application/pdf",
        ]);
    });
});

void describe("synthetic demo transactions seed", () => {
    const approvalQueueStages = ["Submitted", "Manager Approval", "AP Review"];

    void test("gives every non-terminal-stage seeded report a matching gl_coding_result row", async () => {
        // findApprovalQueueLineItems joins from gl_coding_result, so a
        // seeded report with no coding result can never appear in the
        // Approval Queue even when it sits in the right stage.
        const sql = await readFile(demoTransactionsSeedSqlUrl, "utf8");
        const reportRows = [
            ...sql.matchAll(
                /\('(70000000-0000-4000-8000-\d{12})', '([^']+)', false,/g,
            ),
        ].map((match) => {
            const [, id, stage] = match;
            if (id === undefined || stage === undefined) {
                throw new Error("Expected a matched report id and stage.");
            }

            return { id, stage };
        });
        const codedReportIds = new Set(
            [
                ...sql.matchAll(
                    /'(70000000-0000-4000-8000-\d{12})', 'line_item',/g,
                ),
            ].map((match) => {
                const [, id] = match;
                if (id === undefined) {
                    throw new Error("Expected a matched gl_coding_result id.");
                }

                return id;
            }),
        );

        expect(reportRows.length).toBeGreaterThan(0);

        const approvalQueueReports = reportRows.filter((report) =>
            approvalQueueStages.includes(report.stage),
        );

        expect(approvalQueueReports.length).toBeGreaterThan(0);
        for (const report of approvalQueueReports) {
            expect(codedReportIds.has(report.id)).toBe(true);
        }
    });
});
