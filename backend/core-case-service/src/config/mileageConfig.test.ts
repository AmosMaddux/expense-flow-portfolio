import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadMileageConfig } from "./mileageConfig.js";

describe("mileage configuration", () => {
    test("loads a positive reimbursement rate", () => {
        expect(
            loadMileageConfig({
                MILEAGE_REIMBURSEMENT_RATE: "0.70",
            }).reimbursementRate,
        ).toBe(0.7);
    });

    test("rejects a missing or non-positive reimbursement rate", () => {
        expect(() => loadMileageConfig({})).toThrow(ConfigurationError);
        expect(() =>
            loadMileageConfig({
                MILEAGE_REIMBURSEMENT_RATE: "0",
            }),
        ).toThrow(ConfigurationError);
    });
});
