import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadMileageConfig } from "./mileageConfig.js";

describe("mileage configuration", () => {
    test("loads a positive reimbursement rate", () => {
        expect(
            loadMileageConfig({
                MILEAGE_REIMBURSEMENT_RATE: "0.70",
            }),
        ).toStrictEqual({
            reimbursementRate: 0.7,
            reimbursementRateDecimal: "0.70",
        });
    });

    test("rejects a missing or non-positive reimbursement rate", () => {
        expect(() => loadMileageConfig({})).toThrow(ConfigurationError);
        expect(() =>
            loadMileageConfig({
                MILEAGE_REIMBURSEMENT_RATE: "0",
            }),
        ).toThrow(ConfigurationError);
        expect(() =>
            loadMileageConfig({
                MILEAGE_REIMBURSEMENT_RATE: "0.1234567",
            }),
        ).toThrow(ConfigurationError);
    });
});
