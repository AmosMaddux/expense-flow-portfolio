import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadTinEinValidationConfig } from "./tinEinValidationConfig.js";

void describe("TIN/EIN validation client configuration", () => {
    void test("loads bounded SOAP validation settings from the environment", () => {
        const config = loadTinEinValidationConfig({
            TIN_EIN_VALIDATION_WSDL_URL:
                "https://tin-ein.example.test/validation?wsdl",
            TIN_EIN_VALIDATION_OPERATION_NAME: "ValidateSyntheticTinEin",
            TIN_EIN_VALIDATION_TIMEOUT_MS: "3000",
            TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: "25",
            TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: "10000",
        });

        expect(config).toStrictEqual({
            TIN_EIN_VALIDATION_WSDL_URL:
                "https://tin-ein.example.test/validation?wsdl",
            TIN_EIN_VALIDATION_OPERATION_NAME: "ValidateSyntheticTinEin",
            TIN_EIN_VALIDATION_TIMEOUT_MS: 3000,
            TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: 25,
            TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: 10000,
        });
    });

    void test("requires an explicit WSDL URL", () => {
        expect(() => loadTinEinValidationConfig({})).toThrow(
            ConfigurationError,
        );
        expect(() => loadTinEinValidationConfig({})).toThrow(
            "TIN_EIN_VALIDATION_WSDL_URL",
        );
    });

    void test("rejects excessive timeout and breaker settings", () => {
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/validation?wsdl",
                TIN_EIN_VALIDATION_TIMEOUT_MS: "30001",
            }),
        ).toThrow("TIN_EIN_VALIDATION_TIMEOUT_MS");
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/validation?wsdl",
                TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: "101",
            }),
        ).toThrow("TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE");
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/validation?wsdl",
                TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: "300001",
            }),
        ).toThrow("TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS");
    });
});
