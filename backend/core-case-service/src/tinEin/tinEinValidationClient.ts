import { createRequire } from "node:module";

import { z } from "zod";

import type { TinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import { loadDefaultTinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import {
    TinEinValidationServiceError,
    TinEinValidationUnavailableError,
} from "./tinEinValidationErrors.js";

type CircuitBreaker<TArgs extends unknown[], TResult> = {
    fire: (...args: TArgs) => Promise<TResult>;
};

type CircuitBreakerOptions = {
    errorThresholdPercentage: number;
    name: string;
    resetTimeout: number;
    timeout: number;
};

type OpossumModule = new <TArgs extends unknown[], TResult>(
    action: (...args: TArgs) => Promise<TResult>,
    options: CircuitBreakerOptions,
) => CircuitBreaker<TArgs, TResult>;

type SoapClient = Record<string, unknown> & {
    setEndpoint?: (endpointUrl: string) => void;
    setSecurity?: (security: unknown) => void;
};

type SoapModule = {
    createClientAsync: (
        wsdlUrl: string,
        options: WsdlClientOptions,
    ) => Promise<SoapClient>;
    WSSecurity?: new (
        username: string,
        password: string,
        options?: Record<string, unknown>,
    ) => unknown;
};
type SoapOperationOptions = {
    timeout?: number;
};

const nodeRequire = createRequire(import.meta.url);
const OpossumCircuitBreaker = nodeRequire("opossum") as OpossumModule;
const legalNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !containsControlCharacter(value), {
        message: "Legal name cannot include control characters.",
    });

export const TinEinValidationRequestSchema = z.object({
    identifierType: z.enum(["EIN", "SSN"]),
    identifier: z.string().regex(/^\d{9}$/),
    legalName: legalNameSchema,
});

export const TinEinValidationResponseSchema = z.object({
    isValid: z.boolean(),
    normalizedLegalName: z.string().min(1).optional(),
    rejectionReason: z.string().min(1).optional(),
    serviceReferenceId: z.string().min(1).optional(),
    taxpayerStanding: z.enum(["active", "inactive", "suspended"]).optional(),
    taxpayerStandingAsOfDate: z.iso.date().optional(),
});

type ValidationServicePayload = {
    TIN: string;
    TINType: "EIN" | "SSN";
    LegalName: string;
};

type TaxpayerStatusPayload = {
    TIN: string;
    TINType: "EIN" | "SSN";
};

const soapValidationPayloadSchema: z.ZodType<ValidationServicePayload> =
    z.object({
        TIN: z.string().regex(/^\d{9}$/),
        TINType: z.enum(["EIN", "SSN"]),
        LegalName: legalNameSchema,
    });

export type TinEinValidationRequest = z.infer<
    typeof TinEinValidationRequestSchema
>;
export type TinEinValidationResponse = z.infer<
    typeof TinEinValidationResponseSchema
>;

export type TinEinValidationClient = {
    /**
     * Validates a taxpayer identifier through the shared TIN/EIN service.
     */
    validateTinEin(
        request: TinEinValidationRequest,
    ): Promise<TinEinValidationResponse>;
};

type ValidationServiceInvoker = {
    verifyTaxpayer: (
        payload: ValidationServicePayload,
        operationOptions?: SoapOperationOptions,
    ) => Promise<unknown>;
    getTaxpayerStatus?: (
        payload: TaxpayerStatusPayload,
        operationOptions?: SoapOperationOptions,
    ) => Promise<unknown>;
};
type WsdlClientOptions = {
    wsdl_options?: {
        timeout?: number;
    };
};

type ValidationServiceTransportOptions = WsdlClientOptions & {
    endpointUrl?: string;
    username?: string;
    password?: string;
    statusEnrichmentEnabled: boolean;
    statusOperationName: string;
};

type CreateValidationServiceInvoker = (
    wsdlUrl: string,
    operationName: string,
    options: ValidationServiceTransportOptions,
) => Promise<ValidationServiceInvoker>;

export type TinEinValidationClientOptions = {
    createValidationServiceInvoker?: CreateValidationServiceInvoker;
    soapModule?: SoapModule;
};

/**
 * Creates a SOAP-backed TIN/EIN validation client behind a domain-safe interface.
 */
export function createSoapTinEinValidationClient(
    config: TinEinValidationConfig = loadDefaultTinEinValidationConfig(),
    options: TinEinValidationClientOptions = {},
): TinEinValidationClient {
    const createValidationServiceInvoker =
        options.createValidationServiceInvoker ??
        ((wsdlUrl, operationName, transportOptions) =>
            createNodeSoapInvoker(
                wsdlUrl,
                operationName,
                transportOptions,
                options.soapModule,
            ));
    let invokerPromise: Promise<ValidationServiceInvoker> | undefined;

    const readSoapInvoker = (): Promise<ValidationServiceInvoker> => {
        if (invokerPromise === undefined) {
            invokerPromise = createValidationServiceInvoker(
                config.TIN_EIN_VALIDATION_WSDL_URL,
                config.TIN_EIN_VALIDATION_OPERATION_NAME,
                {
                    wsdl_options: {
                        timeout: config.TIN_EIN_VALIDATION_TIMEOUT_MS,
                    },
                    ...(config.TIN_EIN_VALIDATION_ENDPOINT_URL === undefined
                        ? {}
                        : {
                              endpointUrl:
                                  config.TIN_EIN_VALIDATION_ENDPOINT_URL,
                          }),
                    ...(config.TIN_EIN_VALIDATION_USERNAME === undefined
                        ? {}
                        : { username: config.TIN_EIN_VALIDATION_USERNAME }),
                    ...(config.TIN_EIN_VALIDATION_PASSWORD === undefined
                        ? {}
                        : { password: config.TIN_EIN_VALIDATION_PASSWORD }),
                    statusEnrichmentEnabled:
                        config.TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED,
                    statusOperationName:
                        config.TIN_EIN_VALIDATION_STATUS_OPERATION_NAME,
                },
            ).catch((error: unknown) => {
                invokerPromise = undefined;
                throw error;
            });
        }

        return invokerPromise;
    };
    const breaker = new OpossumCircuitBreaker(
        async (
            request: TinEinValidationRequest,
        ): Promise<TinEinValidationResponse> => {
            const invoker = await readSoapInvoker();
            const soapPayload = soapValidationPayloadSchema.parse({
                TIN: request.identifier,
                TINType: toTivsIdentifierType(request.identifierType),
                LegalName: request.legalName,
            });
            const rawSoapResponse = await invoker.verifyTaxpayer(soapPayload, {
                timeout: config.TIN_EIN_VALIDATION_TIMEOUT_MS,
            });
            const validation = toTinEinValidationResponse(rawSoapResponse);
            if (validation.isValid && invoker.getTaxpayerStatus !== undefined) {
                return addTaxpayerStatusIfAvailable(
                    validation,
                    invoker,
                    soapPayload,
                    config.TIN_EIN_VALIDATION_TIMEOUT_MS,
                );
            }

            return validation;
        },
        {
            errorThresholdPercentage:
                config.TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE,
            name: "tin-ein-validation-soap",
            resetTimeout: config.TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS,
            timeout: config.TIN_EIN_VALIDATION_TIMEOUT_MS,
        },
    );

    return {
        async validateTinEin(
            request: TinEinValidationRequest,
        ): Promise<TinEinValidationResponse> {
            const parsedRequest = TinEinValidationRequestSchema.parse(request);

            try {
                return await breaker.fire(parsedRequest);
            } catch (error: unknown) {
                if (error instanceof TinEinValidationServiceError) {
                    throw error;
                }

                const message = failureMessageFor(error);
                const ErrorConstructor = isCircuitBreakerAvailabilityError(
                    error,
                )
                    ? TinEinValidationUnavailableError
                    : TinEinValidationServiceError;

                throw new ErrorConstructor(message, {
                    cause: error,
                });
            }
        },
    };
}

async function createNodeSoapInvoker(
    wsdlUrl: string,
    operationName: string,
    options: ValidationServiceTransportOptions,
    soapModule?: SoapModule,
): Promise<ValidationServiceInvoker> {
    const soap = soapModule ?? (nodeRequire("soap") as SoapModule);
    const soapClient = await soap.createClientAsync(wsdlUrl, {
        ...(options.wsdl_options === undefined
            ? {}
            : { wsdl_options: options.wsdl_options }),
    });
    configureSoapClient(soapClient, soap, options);
    const verifyMethod = readSoapMethod(soapClient, `${operationName}Async`);
    const statusMethod = options.statusEnrichmentEnabled
        ? readSoapMethod(soapClient, `${options.statusOperationName}Async`)
        : undefined;

    return {
        verifyTaxpayer: async (payload, operationOptions) =>
            unwrapSoapOperationResponse(
                await invokeSoapMethod(verifyMethod, payload, operationOptions),
                operationName,
            ),
        ...(statusMethod === undefined
            ? {}
            : {
                  getTaxpayerStatus: async (payload, operationOptions) =>
                      unwrapSoapOperationResponse(
                          await invokeSoapMethod(
                              statusMethod,
                              payload,
                              operationOptions,
                          ),
                          options.statusOperationName,
                      ),
              }),
    };
}

function configureSoapClient(
    soapClient: SoapClient,
    soapModule: SoapModule,
    options: ValidationServiceTransportOptions,
): void {
    if (options.endpointUrl !== undefined) {
        if (typeof soapClient.setEndpoint !== "function") {
            throw new TinEinValidationServiceError(
                "The TIN/EIN validation SOAP client does not support endpoint override.",
            );
        }
        soapClient.setEndpoint(options.endpointUrl);
    }

    if (options.username !== undefined && options.password !== undefined) {
        if (soapModule.WSSecurity === undefined) {
            throw new TinEinValidationServiceError(
                "The TIN/EIN validation SOAP module does not support WS-Security.",
            );
        }
        if (typeof soapClient.setSecurity !== "function") {
            throw new TinEinValidationServiceError(
                "The TIN/EIN validation SOAP client does not support WS-Security.",
            );
        }
        soapClient.setSecurity(
            new soapModule.WSSecurity(options.username, options.password, {
                passwordType: "PasswordText",
            }),
        );
    }
}

async function invokeSoapMethod(
    method: ValidationServiceInvoker["verifyTaxpayer"],
    payload: ValidationServicePayload | TaxpayerStatusPayload,
    operationOptions?: SoapOperationOptions,
): Promise<unknown> {
    try {
        return await method(
            payload as ValidationServicePayload,
            operationOptions,
        );
    } catch (error: unknown) {
        if (isTransportError(error)) {
            throw new TinEinValidationUnavailableError(
                "The TIN/EIN validation service could not be reached.",
                { cause: error },
            );
        }

        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service returned a SOAP fault.",
            { cause: error },
        );
    }
}

function isTransportError(error: unknown): boolean {
    return (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        [
            "ECONNABORTED",
            "ECONNREFUSED",
            "ECONNRESET",
            "EHOSTUNREACH",
            "ENETUNREACH",
            "ETIMEDOUT",
        ].includes(error.code)
    );
}

function containsControlCharacter(value: string): boolean {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (
            codePoint !== undefined &&
            (codePoint <= 0x1f || codePoint === 0x7f)
        ) {
            return true;
        }
    }

    return false;
}

function unwrapSoapOperationResponse(
    response: unknown,
    operationName: string,
): unknown {
    const responseBody: unknown = Array.isArray(response)
        ? response[0]
        : response;
    if (!isRecord(responseBody)) {
        return responseBody;
    }

    for (const wrapperKey of [
        `${operationName}Result`,
        `${operationName}Response`,
    ]) {
        const wrappedResponse = responseBody[wrapperKey];
        if (isRecord(wrappedResponse)) {
            return wrappedResponse;
        }
    }

    return responseBody;
}

function readSoapMethod(
    soapClient: Record<string, unknown>,
    methodName: string,
): ValidationServiceInvoker["verifyTaxpayer"] {
    const method = soapClient[methodName];
    if (typeof method !== "function") {
        throw new TinEinValidationServiceError(
            `The TIN/EIN validation WSDL does not expose ${methodName}.`,
        );
    }

    return (
        payload: ValidationServicePayload,
        operationOptions?: SoapOperationOptions,
    ): Promise<unknown> => {
        const response: unknown = Reflect.apply(method, soapClient, [
            payload,
            operationOptions,
        ]);

        return Promise.resolve(response);
    };
}

function toTinEinValidationResponse(
    rawSoapResponse: unknown,
): TinEinValidationResponse {
    if (!isRecord(rawSoapResponse)) {
        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service returned an invalid response.",
        );
    }

    const tivsMatchCode = readOptionalMatchCode(rawSoapResponse, ["MatchCode"]);
    if (tivsMatchCode !== undefined) {
        return toTivsValidationResponse(rawSoapResponse, tivsMatchCode);
    }

    const valid = readOptionalBoolean(rawSoapResponse, [
        "IsValid",
        "isValid",
        "Valid",
        "valid",
    ]);
    if (valid === undefined) {
        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service response did not include a validity result.",
        );
    }

    const response: TinEinValidationResponse = {
        isValid: valid,
    };
    const normalizedLegalName = readOptionalString(rawSoapResponse, [
        "NormalizedLegalName",
        "normalizedLegalName",
        "MatchedLegalName",
        "matchedLegalName",
    ]);
    const rejectionReason = readOptionalString(rawSoapResponse, [
        "RejectionReason",
        "rejectionReason",
        "Reason",
        "reason",
    ]);
    const serviceReferenceId = readOptionalString(rawSoapResponse, [
        "ServiceReferenceId",
        "serviceReferenceId",
        "CorrelationId",
        "correlationId",
    ]);

    if (normalizedLegalName !== undefined) {
        response.normalizedLegalName = normalizedLegalName;
    }
    if (rejectionReason !== undefined) {
        response.rejectionReason = rejectionReason;
    }
    if (serviceReferenceId !== undefined) {
        response.serviceReferenceId = serviceReferenceId;
    }

    return TinEinValidationResponseSchema.parse(response);
}

function toTivsValidationResponse(
    rawSoapResponse: Record<string, unknown>,
    matchCode: string,
): TinEinValidationResponse {
    if (matchCode === "0") {
        return TinEinValidationResponseSchema.parse({
            isValid: true,
            ...(readOptionalString(rawSoapResponse, ["VerifiedName"]) ===
            undefined
                ? {}
                : {
                      normalizedLegalName: readOptionalString(rawSoapResponse, [
                          "VerifiedName",
                      ]),
                  }),
        });
    }

    return TinEinValidationResponseSchema.parse({
        isValid: false,
        rejectionReason: rejectionReasonForTivsMatchCode(matchCode),
    });
}

async function addTaxpayerStatusIfAvailable(
    validation: TinEinValidationResponse,
    invoker: ValidationServiceInvoker,
    soapPayload: ValidationServicePayload,
    timeout: number,
): Promise<TinEinValidationResponse> {
    if (invoker.getTaxpayerStatus === undefined) {
        return validation;
    }

    let statusResponse: unknown;
    try {
        statusResponse = await invoker.getTaxpayerStatus(
            {
                TIN: soapPayload.TIN,
                TINType: soapPayload.TINType,
            },
            {
                timeout,
            },
        );
    } catch (error: unknown) {
        if (error instanceof TinEinValidationServiceError) {
            return validation;
        }

        throw error;
    }

    try {
        return addTaxpayerStatus(validation, statusResponse);
    } catch (error: unknown) {
        if (
            error instanceof TinEinValidationServiceError ||
            error instanceof z.ZodError
        ) {
            return validation;
        }

        throw error;
    }
}

function addTaxpayerStatus(
    validation: TinEinValidationResponse,
    rawStatusResponse: unknown,
): TinEinValidationResponse {
    if (!isRecord(rawStatusResponse)) {
        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service returned an invalid taxpayer status response.",
        );
    }

    const standing = readOptionalString(rawStatusResponse, ["Standing"]);
    const asOfDate = readOptionalString(rawStatusResponse, ["AsOfDate"]);
    if (standing === undefined || asOfDate === undefined) {
        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service taxpayer status response was incomplete.",
        );
    }

    return TinEinValidationResponseSchema.parse({
        ...validation,
        taxpayerStanding: standing.toLowerCase(),
        taxpayerStandingAsOfDate: parseLegacyMmddyyyy(asOfDate),
    });
}

function rejectionReasonForTivsMatchCode(matchCode: string): string {
    if (matchCode === "1") {
        return "Taxpayer identifier has not been issued.";
    }
    if (matchCode === "2") {
        return "Taxpayer identifier was not found.";
    }
    if (matchCode === "3") {
        return "Taxpayer identifier and legal name do not match.";
    }

    throw new TinEinValidationServiceError(
        "The TIN/EIN validation service returned an unknown match code.",
    );
}

function parseLegacyMmddyyyy(value: string): string {
    if (!/^\d{8}$/.test(value)) {
        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service returned an invalid status date.",
        );
    }

    const month = value.slice(0, 2);
    const day = value.slice(2, 4);
    const year = value.slice(4, 8);
    const isoDate = `${year}-${month}-${day}`;
    if (!z.iso.date().safeParse(isoDate).success) {
        throw new TinEinValidationServiceError(
            "The TIN/EIN validation service returned an invalid status date.",
        );
    }

    return isoDate;
}

function toTivsIdentifierType(
    identifierType: TinEinValidationRequest["identifierType"],
): "EIN" | "SSN" {
    return identifierType;
}

function readOptionalMatchCode(
    record: Record<string, unknown>,
    keys: string[],
): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "number" && Number.isInteger(value)) {
            return value.toString();
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (/^\d+$/.test(trimmed)) {
                return trimmed;
            }
        }
    }

    return undefined;
}

function readOptionalBoolean(
    record: Record<string, unknown>,
    keys: string[],
): boolean | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "1", "yes"].includes(normalized)) {
                return true;
            }
            if (["false", "0", "no"].includes(normalized)) {
                return false;
            }
        }
    }

    return undefined;
}

function readOptionalString(
    record: Record<string, unknown>,
    keys: string[],
): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                return trimmed;
            }
        }
    }

    return undefined;
}

function isCircuitBreakerAvailabilityError(error: unknown): boolean {
    return (
        isRecord(error) &&
        (error.code === "EOPENBREAKER" || error.code === "ETIMEDOUT")
    );
}
function failureMessageFor(error: unknown): string {
    if (isRecord(error) && error.code === "EOPENBREAKER") {
        return "The TIN/EIN validation circuit breaker is open.";
    }

    if (isRecord(error) && error.code === "ETIMEDOUT") {
        return "The TIN/EIN validation service request timed out.";
    }

    return "The TIN/EIN validation service request failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}
