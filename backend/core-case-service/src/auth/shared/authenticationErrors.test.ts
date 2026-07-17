import { describe, expect, test } from "vitest";

import { InvalidMfaEnrollmentConfigurationError } from "./authenticationErrors.js";

void describe("authentication errors", () => {
    void test("creates an invalid MFA enrollment configuration domain error", () => {
        const error = new InvalidMfaEnrollmentConfigurationError();

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
            name: "InvalidMfaEnrollmentConfigurationError",
            message: "MFA enrollment configuration is invalid.",
        });
    });
});
