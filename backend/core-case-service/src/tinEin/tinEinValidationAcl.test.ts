import { describe, expect, test, vi } from "vitest";

import type { TinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import {
    createEinValidationAcl,
    EinValidationRequestSchema,
} from "./tinEinValidationAcl.js";
import { createSoapTinEinValidationClient } from "./tinEinValidationClient.js";
import { TinEinValidationServiceError } from "./tinEinValidationErrors.js";

const config: TinEinValidationConfig = {
    TIN_EIN_VALIDATION_WSDL_URL: "https://tin-ein.example.test/validation?wsdl",
    TIN_EIN_VALIDATION_OPERATION_NAME: "ValidateSyntheticTinEin",
    TIN_EIN_VALIDATION_STATUS_OPERATION_NAME: "GetSyntheticTaxpayerStatus",
    TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED: true,
    TIN_EIN_VALIDATION_TIMEOUT_MS: 100,
    TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: 50,
    TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: 1000,
};

const request = {
    ein: "123456789",
    legalName: "Synthetic Expense Vendor LLC",
};

void describe("TIN/EIN validation anti-corruption layer", () => {
    void test("translates a valid wrapped SOAP response into the internal EIN validation model", async () => {
        const soapClient: Record<string, unknown> = {};
        const validateSyntheticTinEinAsync = vi.fn(() =>
            Promise.resolve([
                {
                    ValidateSyntheticTinEinResult: {
                        IsValid: "true",
                        NormalizedLegalName: "Synthetic Expense Vendor LLC",
                        ServiceReferenceId: "synthetic-reference-101",
                    },
                },
            ]),
        );
        const getSyntheticTaxpayerStatusAsync = vi.fn(() =>
            Promise.resolve([
                {
                    GetSyntheticTaxpayerStatusResponse: {
                        Standing: "ACTIVE",
                        AsOfDate: "07302026",
                    },
                },
            ]),
        );
        soapClient.ValidateSyntheticTinEinAsync = validateSyntheticTinEinAsync;
        soapClient.GetSyntheticTaxpayerStatusAsync =
            getSyntheticTaxpayerStatusAsync;
        const acl = createEinValidationAcl({
            tinEinValidationClient: createSoapTinEinValidationClient(config, {
                soapModule: {
                    createClientAsync: vi.fn(() => Promise.resolve(soapClient)),
                },
            }),
        });

        await expect(acl.validateEin(request)).resolves.toStrictEqual({
            status: "valid",
            isValid: true,
            normalizedLegalName: "Synthetic Expense Vendor LLC",
            serviceReferenceId: "synthetic-reference-101",
            taxpayerStanding: "active",
            taxpayerStandingAsOfDate: "2026-07-30",
        });
        expect(validateSyntheticTinEinAsync).toHaveBeenCalledWith(
            {
                TIN: "123456789",
                TINType: "EIN",
                LegalName: "Synthetic Expense Vendor LLC",
            },
            {
                timeout: 100,
            },
        );
        expect(getSyntheticTaxpayerStatusAsync).toHaveBeenCalledWith(
            {
                TIN: "123456789",
                TINType: "EIN",
            },
            {
                timeout: 100,
            },
        );
    });

    void test("translates an invalid EIN SOAP response without leaking SOAP fields", async () => {
        const soapClient: Record<string, unknown> = {
            ValidateSyntheticTinEinAsync: vi.fn(() =>
                Promise.resolve([
                    {
                        ValidateSyntheticTinEinResponse: {
                            Valid: "0",
                            RejectionReason:
                                "Synthetic EIN and legal name mismatch.",
                            CorrelationId: "synthetic-reference-102",
                        },
                    },
                ]),
            ),
            GetSyntheticTaxpayerStatusAsync: vi.fn(),
        };
        const acl = createEinValidationAcl({
            tinEinValidationClient: createSoapTinEinValidationClient(config, {
                soapModule: {
                    createClientAsync: vi.fn(() => Promise.resolve(soapClient)),
                },
            }),
        });

        await expect(acl.validateEin(request)).resolves.toStrictEqual({
            status: "invalid",
            isValid: false,
            rejectionReason: "Synthetic EIN and legal name mismatch.",
            serviceReferenceId: "synthetic-reference-102",
        });
    });

    void test("handles service errors without crashing the submission flow", async () => {
        const acl = createEinValidationAcl({
            tinEinValidationClient: {
                validateTinEin: vi
                    .fn()
                    .mockRejectedValue(
                        new TinEinValidationServiceError(
                            "The TIN/EIN validation service request timed out.",
                        ),
                    ),
            },
        });

        await expect(acl.validateEin(request)).resolves.toStrictEqual({
            status: "unreachable",
            isValid: false,
            rejectionReason: "EIN validation is temporarily unavailable.",
        });
    });

    void test("handles known transport failures without crashing the submission flow", async () => {
        const transportError = Object.assign(
            new Error("Synthetic socket reset."),
            { code: "ECONNRESET" },
        );
        const acl = createEinValidationAcl({
            tinEinValidationClient: {
                validateTinEin: vi.fn().mockRejectedValue(transportError),
            },
        });

        await expect(acl.validateEin(request)).resolves.toStrictEqual({
            status: "unreachable",
            isValid: false,
            rejectionReason: "EIN validation is temporarily unavailable.",
        });
    });

    void test("does not hide dependency programming errors as service outages", async () => {
        const acl = createEinValidationAcl({
            tinEinValidationClient: {
                validateTinEin: vi
                    .fn()
                    .mockRejectedValue(
                        new TypeError("Synthetic adapter contract bug."),
                    ),
            },
        });

        await expect(acl.validateEin(request)).rejects.toBeInstanceOf(
            TypeError,
        );
    });

    void test("rejects malformed EIN validation requests before calling SOAP", () => {
        expect(() =>
            EinValidationRequestSchema.parse({
                ...request,
                ein: "12-3456789",
            }),
        ).toThrow();
        expect(() =>
            EinValidationRequestSchema.parse({
                ...request,
                legalName: "   ",
            }),
        ).toThrow();
        expect(() =>
            EinValidationRequestSchema.parse({
                ...request,
                legalName: "Synthetic\nVendor LLC",
            }),
        ).toThrow("Legal name cannot include control characters.");
        expect(() =>
            EinValidationRequestSchema.parse({
                ...request,
                legalName: "S".repeat(201),
            }),
        ).toThrow();
    });
});
