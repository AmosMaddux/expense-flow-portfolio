import { describe, expect, test, vi } from "vitest";

import {
    createSoapTinEinValidationClient,
    TinEinValidationRequestSchema,
} from "./tinEinValidationClient.js";
import type { TinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import { TinEinValidationServiceError } from "./tinEinValidationErrors.js";

const config: TinEinValidationConfig = {
    TIN_EIN_VALIDATION_WSDL_URL: "https://tin-ein.example.test/validation?wsdl",
    TIN_EIN_VALIDATION_OPERATION_NAME: "ValidateSyntheticTinEin",
    TIN_EIN_VALIDATION_TIMEOUT_MS: 100,
    TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: 50,
    TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: 1000,
};

const request = {
    identifierType: "EIN" as const,
    identifier: "123456789",
    legalName: "Synthetic Expense Vendor LLC",
};

void describe("SOAP TIN/EIN validation client", () => {
    void test("rejects identifiers that are not exactly nine digits", () => {
        expect(() =>
            TinEinValidationRequestSchema.parse({
                ...request,
                identifier: "12-3456789",
            }),
        ).toThrow();
    });

    void test("creates a SOAP invoker from the shared WSDL and maps the response", async () => {
        const validationServiceInvoker = vi.fn().mockResolvedValue({
            IsValid: "true",
            NormalizedLegalName: "Synthetic Expense Vendor LLC",
            ServiceReferenceId: "synthetic-reference-001",
        });
        const createValidationServiceInvoker = vi
            .fn()
            .mockResolvedValue(validationServiceInvoker);
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker,
        });

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: true,
            normalizedLegalName: "Synthetic Expense Vendor LLC",
            serviceReferenceId: "synthetic-reference-001",
        });

        expect(createValidationServiceInvoker).toHaveBeenCalledWith(
            "https://tin-ein.example.test/validation?wsdl",
            "ValidateSyntheticTinEin",
            {
                wsdl_options: {
                    timeout: 100,
                },
            },
        );
        expect(validationServiceInvoker).toHaveBeenCalledWith({
            IdentifierType: "EIN",
            Identifier: "123456789",
            LegalName: "Synthetic Expense Vendor LLC",
        });
    });

    void test("maps rejected validations without leaking SOAP field names", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve(() =>
                    Promise.resolve({
                        valid: false,
                        reason: "Synthetic mismatch.",
                        correlationId: "synthetic-reference-002",
                    }),
                ),
        });

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: false,
            rejectionReason: "Synthetic mismatch.",
            serviceReferenceId: "synthetic-reference-002",
        });
    });

    void test("maps string false validation flags from the SOAP response", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve(() =>
                    Promise.resolve({
                        Valid: "0",
                    }),
                ),
        });

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: false,
        });
    });

    void test("rejects malformed SOAP responses", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve(() =>
                    Promise.resolve({
                        ServiceReferenceId: "synthetic-reference-003",
                    }),
                ),
        });

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message:
                "The TIN/EIN validation service response did not include a validity result.",
        });
    });

    void test("rejects non-object SOAP responses", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve(() => Promise.resolve("not-an-object")),
        });

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message:
                "The TIN/EIN validation service returned an invalid response.",
        });
    });

    void test("wraps downstream failures in the TIN/EIN service error", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve(() =>
                    Promise.reject(new Error("synthetic SOAP outage")),
                ),
        });

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message: "The TIN/EIN validation service request failed.",
        });
    });

    void test("wraps circuit breaker timeouts in the TIN/EIN service error", async () => {
        const client = createSoapTinEinValidationClient(
            {
                ...config,
                TIN_EIN_VALIDATION_TIMEOUT_MS: 1,
            },
            {
                createValidationServiceInvoker: () =>
                    Promise.resolve(
                        () =>
                            new Promise((resolve) => {
                                setTimeout(
                                    () =>
                                        resolve({
                                            IsValid: true,
                                        }),
                                    50,
                                );
                            }),
                    ),
            },
        );

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message: "The TIN/EIN validation service request timed out.",
        });
    });

    void test("fails fast through the circuit breaker after a downstream failure", async () => {
        const alwaysFails = vi
            .fn()
            .mockRejectedValue(new Error("synthetic SOAP outage"));
        const client = createSoapTinEinValidationClient(
            {
                ...config,
                TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: 1,
            },
            {
                createValidationServiceInvoker: () =>
                    Promise.resolve(alwaysFails),
            },
        );

        await expect(client.validateTinEin(request)).rejects.toBeInstanceOf(
            TinEinValidationServiceError,
        );
        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            message: "The TIN/EIN validation circuit breaker is open.",
        });
        expect(alwaysFails).toHaveBeenCalledTimes(1);
    });
});
