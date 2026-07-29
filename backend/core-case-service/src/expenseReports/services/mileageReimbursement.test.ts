import { describe, expect, test } from "vitest";

import { calculateMileageReimbursement } from "./mileageReimbursement.js";

describe("calculateMileageReimbursement", () => {
    test.each([
        ["12.50", "0.70", 8.75],
        ["0.01", "0.50", 0.01],
        ["0.01", "0.49", 0],
        ["12.35", "0.675", 8.34],
        ["999999.99", "100", 99999999],
    ])(
        "calculates %s miles at %s dollars per mile as %s",
        (distance, rate, expected) => {
            expect(calculateMileageReimbursement(distance, rate)).toBe(
                expected,
            );
        },
    );

    test("rejects non-decimal mileage values", () => {
        expect(() => calculateMileageReimbursement("1e2", "0.70")).toThrow(
            "Mileage values must be unsigned decimal strings.",
        );
    });
});
