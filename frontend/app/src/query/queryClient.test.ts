import { describe, expect, test } from "vitest";

import { AuthRequestError } from "../auth";
import { shouldRetryQueryFailure } from "./queryClient";

describe("shouldRetryQueryFailure", () => {
    test("does not retry terminal authentication failures", () => {
        expect(
            shouldRetryQueryFailure(
                0,
                new AuthRequestError(401, "Authentication was rejected."),
            ),
        ).toBe(false);
    });

    test("allows the standard retry budget for non-auth failures", () => {
        expect(
            shouldRetryQueryFailure(0, new Error("Synthetic failure.")),
        ).toBe(true);
        expect(
            shouldRetryQueryFailure(1, new Error("Synthetic failure.")),
        ).toBe(true);
        expect(
            shouldRetryQueryFailure(2, new Error("Synthetic failure.")),
        ).toBe(false);
    });
});
