import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadTinEinValidationConfig } from "./tinEinValidationConfig.js";

void describe("TIN/EIN validation client configuration", () => {
    void test("loads bounded SOAP validation settings from the environment", () => {
        const config = loadTinEinValidationConfig({
            TIN_EIN_VALIDATION_WSDL_URL:
                "https://tin-ein.example.test/tivs?wsdl",
            TIN_EIN_VALIDATION_ENDPOINT_URL:
                "https://tin-ein.example.test/tivs",
            TIN_EIN_VALIDATION_OPERATION_NAME: "VerifyTaxpayer",
            TIN_EIN_VALIDATION_STATUS_OPERATION_NAME: "GetTaxpayerStatus",
            TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED: "true",
            TIN_EIN_VALIDATION_USERNAME: "synthetic-user",
            TIN_EIN_VALIDATION_PASSWORD: "synthetic-password",
            TIN_EIN_VALIDATION_TIMEOUT_MS: "3000",
            TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: "25",
            TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: "10000",
        });

        expect(config).toStrictEqual({
            TIN_EIN_VALIDATION_WSDL_URL:
                "https://tin-ein.example.test/tivs?wsdl",
            TIN_EIN_VALIDATION_ENDPOINT_URL:
                "https://tin-ein.example.test/tivs",
            TIN_EIN_VALIDATION_OPERATION_NAME: "VerifyTaxpayer",
            TIN_EIN_VALIDATION_STATUS_OPERATION_NAME: "GetTaxpayerStatus",
            TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED: true,
            TIN_EIN_VALIDATION_USERNAME: "synthetic-user",
            TIN_EIN_VALIDATION_PASSWORD: "synthetic-password",
            TIN_EIN_VALIDATION_TIMEOUT_MS: 3000,
            TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: 25,
            TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: 10000,
        });
    });

    void test("defaults to the live TIVS operation names", () => {
        const config = loadTinEinValidationConfig({
            TIN_EIN_VALIDATION_WSDL_URL:
                "https://tin-ein.example.test/tivs?wsdl",
        });

        expect(config.TIN_EIN_VALIDATION_OPERATION_NAME).toBe("VerifyTaxpayer");
        expect(config.TIN_EIN_VALIDATION_STATUS_OPERATION_NAME).toBe(
            "GetTaxpayerStatus",
        );
    });

    void test("parses explicit status enrichment booleans", () => {
        expect(
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED: "true",
            }).TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED,
        ).toBe(true);
        expect(
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED: "false",
            }).TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED,
        ).toBe(false);
    });

    void test("requires an explicit WSDL URL", () => {
        expect(() => loadTinEinValidationConfig({})).toThrow(
            ConfigurationError,
        );
        expect(() => loadTinEinValidationConfig({})).toThrow(
            "TIN_EIN_VALIDATION_WSDL_URL",
        );
    });

    void test("requires complete UsernameToken settings when authentication is configured", () => {
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_USERNAME: "synthetic-user",
            }),
        ).toThrow("TIN_EIN_VALIDATION_PASSWORD");
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_PASSWORD: "synthetic-password",
            }),
        ).toThrow("TIN_EIN_VALIDATION_USERNAME");
    });

    void test("rejects excessive timeout and breaker settings", () => {
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_TIMEOUT_MS: "30001",
            }),
        ).toThrow("TIN_EIN_VALIDATION_TIMEOUT_MS");
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: "101",
            }),
        ).toThrow("TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE");
        expect(() =>
            loadTinEinValidationConfig({
                TIN_EIN_VALIDATION_WSDL_URL:
                    "https://tin-ein.example.test/tivs?wsdl",
                TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: "300001",
            }),
        ).toThrow("TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS");
    });
});
