import { describe, expect, test, vi } from "vitest";

import type { TinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import {
    createSoapTinEinValidationClient,
    TinEinValidationRequestSchema,
} from "./tinEinValidationClient.js";
import { TinEinValidationServiceError } from "./tinEinValidationErrors.js";

const config: TinEinValidationConfig = {
    TIN_EIN_VALIDATION_WSDL_URL: "https://tin-ein.example.test/tivs?wsdl",
    TIN_EIN_VALIDATION_ENDPOINT_URL: "https://tin-ein.example.test/tivs",
    TIN_EIN_VALIDATION_OPERATION_NAME: "VerifyTaxpayer",
    TIN_EIN_VALIDATION_STATUS_OPERATION_NAME: "GetTaxpayerStatus",
    TIN_EIN_VALIDATION_USERNAME: "synthetic-user",
    TIN_EIN_VALIDATION_PASSWORD: "synthetic-password",
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

    void test("accepts SSN as the TIVS individual taxpayer discriminator", () => {
        expect(
            TinEinValidationRequestSchema.parse({
                ...request,
                identifierType: "SSN",
            }).identifierType,
        ).toBe("SSN");
    });

    void test("rejects whitespace-only legal names", () => {
        expect(() =>
            TinEinValidationRequestSchema.parse({
                ...request,
                legalName: "   ",
            }),
        ).toThrow();
    });

    void test("rejects legal names with XML-hostile control characters", () => {
        for (const legalName of [
            "Synthetic\nVendor LLC",
            "Synthetic\u0000Vendor LLC",
        ]) {
            expect(() =>
                TinEinValidationRequestSchema.parse({
                    ...request,
                    legalName,
                }),
            ).toThrow();
        }
    });

    void test("creates a TIVS SOAP invoker from the shared WSDL and maps a match response", async () => {
        const verifyTaxpayer = vi.fn().mockResolvedValue({
            MatchCode: "0",
            VerifiedName: "Synthetic Expense Vendor LLC",
            TINType: "EIN",
        });
        const getTaxpayerStatus = vi.fn().mockResolvedValue({
            Standing: "ACTIVE",
            AsOfDate: "07302026",
        });
        const createValidationServiceInvoker = vi.fn().mockResolvedValue({
            verifyTaxpayer,
            getTaxpayerStatus,
        });
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker,
        });

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: true,
            normalizedLegalName: "Synthetic Expense Vendor LLC",
            taxpayerStanding: "active",
            taxpayerStandingAsOfDate: "2026-07-30",
        });

        expect(createValidationServiceInvoker).toHaveBeenCalledWith(
            "https://tin-ein.example.test/tivs?wsdl",
            "VerifyTaxpayer",
            {
                wsdl_options: {
                    timeout: 100,
                },
                endpointUrl: "https://tin-ein.example.test/tivs",
                username: "synthetic-user",
                password: "synthetic-password",
                statusOperationName: "GetTaxpayerStatus",
            },
        );
        expect(verifyTaxpayer).toHaveBeenCalledWith(
            {
                TIN: "123456789",
                TINType: "EIN",
                LegalName: "Synthetic Expense Vendor LLC",
            },
            {
                timeout: 100,
            },
        );
        expect(getTaxpayerStatus).toHaveBeenCalledWith(
            {
                TIN: "123456789",
                TINType: "EIN",
            },
            {
                timeout: 100,
            },
        );
    });

    void test("maps TIN requests to the TIVS SSN discriminator", async () => {
        const verifyTaxpayer = vi.fn().mockResolvedValue({
            MatchCode: "3",
            TINType: "SSN",
        });
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve({ verifyTaxpayer }),
        });

        await expect(
            client.validateTinEin({
                ...request,
                identifierType: "TIN",
            }),
        ).resolves.toStrictEqual({
            isValid: false,
            rejectionReason: "Taxpayer identifier and legal name do not match.",
        });
        expect(verifyTaxpayer).toHaveBeenCalledWith(
            expect.objectContaining({ TINType: "SSN" }),
            expect.any(Object),
        );
    });

    void test("maps live TIVS invalid match codes to clean rejection reasons", async () => {
        const cases = [
            ["1", "Taxpayer identifier has not been issued."],
            ["2", "Taxpayer identifier was not found."],
            ["3", "Taxpayer identifier and legal name do not match."],
        ] as const;

        for (const [matchCode, rejectionReason] of cases) {
            const client = createSoapTinEinValidationClient(config, {
                createValidationServiceInvoker: () =>
                    Promise.resolve({
                        verifyTaxpayer: vi.fn().mockResolvedValue({
                            MatchCode: matchCode,
                            TINType: "EIN",
                        }),
                    }),
            });

            await expect(client.validateTinEin(request)).resolves.toStrictEqual(
                {
                    isValid: false,
                    rejectionReason,
                },
            );
        }
    });

    void test("uses the node-soap adapter with endpoint override and UsernameToken security", async () => {
        const soapClient = {
            setEndpoint: vi.fn(),
            setSecurity: vi.fn(),
            VerifyTaxpayerAsync: vi.fn(function (
                this: Record<string, unknown>,
            ) {
                expect(this).toBe(soapClient);

                return Promise.resolve([
                    {
                        VerifyTaxpayerResponse: {
                            MatchCode: "0",
                            VerifiedName: "Synthetic Expense Vendor LLC",
                            TINType: "EIN",
                        },
                    },
                ]);
            }),
            GetTaxpayerStatusAsync: vi.fn(() =>
                Promise.resolve([
                    {
                        GetTaxpayerStatusResponse: {
                            Standing: "ACTIVE",
                            AsOfDate: "07302026",
                        },
                    },
                ]),
            ),
        };
        const WSSecurity = vi.fn(function (
            this: Record<string, unknown>,
            username: string,
            password: string,
            options?: Record<string, unknown>,
        ) {
            this.username = username;
            this.password = password;
            this.options = options;
        });
        const soapModule = {
            createClientAsync: vi.fn(() => Promise.resolve(soapClient)),
            WSSecurity,
        };
        const client = createSoapTinEinValidationClient(config, {
            soapModule,
        });

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: true,
            normalizedLegalName: "Synthetic Expense Vendor LLC",
            taxpayerStanding: "active",
            taxpayerStandingAsOfDate: "2026-07-30",
        });

        expect(soapModule.createClientAsync).toHaveBeenCalledWith(
            "https://tin-ein.example.test/tivs?wsdl",
            {
                wsdl_options: {
                    timeout: 100,
                },
            },
        );
        expect(soapClient.setEndpoint).toHaveBeenCalledWith(
            "https://tin-ein.example.test/tivs",
        );
        expect(WSSecurity).toHaveBeenCalledWith(
            "synthetic-user",
            "synthetic-password",
            {
                passwordType: "PasswordText",
            },
        );
        expect(soapClient.setSecurity).toHaveBeenCalledWith(
            expect.objectContaining({
                username: "synthetic-user",
                password: "synthetic-password",
            }),
        );
        expect(soapClient.VerifyTaxpayerAsync).toHaveBeenCalledWith(
            {
                TIN: "123456789",
                TINType: "EIN",
                LegalName: "Synthetic Expense Vendor LLC",
            },
            {
                timeout: 100,
            },
        );
    });

    void test("rejects WSDLs that do not expose the configured operation", async () => {
        const soapModule = {
            createClientAsync: vi.fn(() =>
                Promise.resolve({
                    setEndpoint: vi.fn(),
                    setSecurity: vi.fn(),
                }),
            ),
            WSSecurity: vi.fn(),
        };
        const client = createSoapTinEinValidationClient(config, {
            soapModule,
        });

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message:
                "The TIN/EIN validation WSDL does not expose VerifyTaxpayerAsync.",
        });
    });

    void test("retries SOAP invoker creation after a transient setup failure", async () => {
        const verifyTaxpayer = vi.fn().mockResolvedValue({
            MatchCode: "0",
            VerifiedName: "Synthetic Expense Vendor LLC",
            TINType: "EIN",
        });
        const createValidationServiceInvoker = vi
            .fn()
            .mockRejectedValueOnce(new Error("synthetic WSDL outage"))
            .mockResolvedValueOnce({ verifyTaxpayer });
        const client = createSoapTinEinValidationClient(
            {
                ...config,
                TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: 1,
            },
            {
                createValidationServiceInvoker,
            },
        );

        await expect(client.validateTinEin(request)).rejects.toBeInstanceOf(
            TinEinValidationServiceError,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: true,
            normalizedLegalName: "Synthetic Expense Vendor LLC",
        });
        expect(createValidationServiceInvoker).toHaveBeenCalledTimes(2);
    });

    void test("keeps backward-compatible response aliases for the pre-TIVS mapper", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve({
                    verifyTaxpayer: vi.fn().mockResolvedValue({
                        valid: false,
                        reason: "Synthetic mismatch.",
                        correlationId: "synthetic-reference-002",
                    }),
                }),
        });

        await expect(client.validateTinEin(request)).resolves.toStrictEqual({
            isValid: false,
            rejectionReason: "Synthetic mismatch.",
            serviceReferenceId: "synthetic-reference-002",
        });
    });

    void test("rejects malformed SOAP responses", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve({
                    verifyTaxpayer: vi.fn().mockResolvedValue({
                        TINType: "EIN",
                    }),
                }),
        });

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message:
                "The TIN/EIN validation service response did not include a validity result.",
        });
    });

    void test("rejects invalid taxpayer status dates", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve({
                    verifyTaxpayer: vi.fn().mockResolvedValue({
                        MatchCode: "0",
                        VerifiedName: "Synthetic Expense Vendor LLC",
                        TINType: "EIN",
                    }),
                    getTaxpayerStatus: vi.fn().mockResolvedValue({
                        Standing: "ACTIVE",
                        AsOfDate: "13322026",
                    }),
                }),
        });

        await expect(client.validateTinEin(request)).rejects.toMatchObject({
            name: "TinEinValidationServiceError",
            message:
                "The TIN/EIN validation service returned an invalid status date.",
        });
    });

    void test("wraps downstream failures in the TIN/EIN service error", async () => {
        const client = createSoapTinEinValidationClient(config, {
            createValidationServiceInvoker: () =>
                Promise.resolve({
                    verifyTaxpayer: vi
                        .fn()
                        .mockRejectedValue(new Error("synthetic SOAP outage")),
                }),
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
                    Promise.resolve({
                        verifyTaxpayer: vi.fn(
                            () =>
                                new Promise((resolve) => {
                                    setTimeout(
                                        () =>
                                            resolve({
                                                MatchCode: "0",
                                                VerifiedName:
                                                    "Synthetic Expense Vendor LLC",
                                                TINType: "EIN",
                                            }),
                                        50,
                                    );
                                }),
                        ),
                    }),
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
                    Promise.resolve({ verifyTaxpayer: alwaysFails }),
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
