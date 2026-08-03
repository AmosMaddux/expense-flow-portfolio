import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const receiptFixtureDirectory = new URL(
    "../../../../scripts/fixtures/receipts/",
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
