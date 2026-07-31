import { describe, expect, test } from "vitest";

import {
    generateLocalTotpCode,
    getLocalTotpSecondsRemaining,
} from "./localTotp.js";

describe("generateLocalTotpCode", () => {
    test("matches the RFC 6238 SHA1 test vector at 59 seconds", () => {
        expect(
            generateLocalTotpCode(
                "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                8,
                30,
                new Date(59_000),
            ),
        ).toBe("94287082");
    });

    test("pads six-digit codes", () => {
        expect(
            generateLocalTotpCode(
                "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                6,
                30,
                new Date(1_111_111_109_000),
            ),
        ).toMatch(/^\d{6}$/);
    });

    test("reports time remaining in the active interval", () => {
        expect(getLocalTotpSecondsRemaining(30, new Date(1_000))).toBe(29);
        expect(getLocalTotpSecondsRemaining(30, new Date(29_000))).toBe(1);
        expect(getLocalTotpSecondsRemaining(30, new Date(30_000))).toBe(30);
    });
});
