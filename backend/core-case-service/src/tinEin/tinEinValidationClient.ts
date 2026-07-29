import { createRequire } from "node:module";

import { z } from "zod";

import type { TinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import { loadDefaultTinEinValidationConfig } from "../config/tinEinValidationConfig.js";
import { TinEinValidationServiceError } from "./tinEinValidationErrors.js";

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

type SoapModule = {
    createClientAsync: (
        wsdlUrl: string,
        options: WsdlClientOptions,
    ) => Promise<Record<string, unknown>>;
};

const nodeRequire = createRequire(import.meta.url);
const OpossumCircuitBreaker = nodeRequire("opossum") as OpossumModule;

export const TinEinValidationRequestSchema = z.object({
    identifierType: z.enum(["TIN", "EIN"]),
    identifier: z.string().regex(/^\d{9}$/),
    legalName: z.string().min(1).max(200),
});

export const TinEinValidationResponseSchema = z.object({
    isValid: z.boolean(),
    normalizedLegalName: z.string().min(1).optional(),
    rejectionReason: z.string().min(1).optional(),
    serviceReferenceId: z.string().min(1).optional(),
});

type ValidationServicePayload = {
    IdentifierType: "TIN" | "EIN";
    Identifier: string;
    LegalName: string;
};

const soapValidationPayloadSchema: z.ZodType<ValidationServicePayload> =
    z.object({
        IdentifierType: z.enum(["TIN", "EIN"]),
        Identifier: z.string().regex(/^\d{9}$/),
        LegalName: z.string().min(1).max(200),
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

type ValidationServiceInvoker = (payload: unknown) => Promise<unknown>;
type WsdlClientOptions = {
    wsdl_options?: {
        timeout?: number;
    };
};

type CreateValidationServiceInvoker = (
    wsdlUrl: string,
    operationName: string,
    options: WsdlClientOptions,
) => Promise<ValidationServiceInvoker>;

export type TinEinValidationClientOptions = {
    createValidationServiceInvoker?: CreateValidationServiceInvoker;
};

/**
 * Creates a SOAP-backed TIN/EIN validation client behind a domain-safe interface.
 */
export function createSoapTinEinValidationClient(
    config: TinEinValidationConfig = loadDefaultTinEinValidationConfig(),
    options: TinEinValidationClientOptions = {},
): TinEinValidationClient {
    const createValidationServiceInvoker =
        options.createValidationServiceInvoker ?? createNodeSoapInvoker;
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
                },
            );
        }

        return invokerPromise;
    };
    const breaker = new OpossumCircuitBreaker(
        async (
            request: TinEinValidationRequest,
        ): Promise<TinEinValidationResponse> => {
            const invoker = await readSoapInvoker();
            const soapPayload = soapValidationPayloadSchema.parse({
                IdentifierType: request.identifierType,
                Identifier: request.identifier,
                LegalName: request.legalName,
            });
            const rawSoapResponse = await invoker(soapPayload);

            return toTinEinValidationResponse(rawSoapResponse);
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

                throw new TinEinValidationServiceError(
                    failureMessageFor(error),
                    {
                        cause: error,
                    },
                );
            }
        },
    };
}

async function createNodeSoapInvoker(
    wsdlUrl: string,
    operationName: string,
    options: WsdlClientOptions,
): Promise<ValidationServiceInvoker> {
    const { createClientAsync } = nodeRequire("soap") as SoapModule;
    const soapClient = await createClientAsync(wsdlUrl, options);
    const asyncMethodName = `${operationName}Async`;
    const soapMethod = readSoapMethod(soapClient, asyncMethodName);

    return async (payload) => {
        try {
            const response: unknown = await soapMethod(payload);

            if (Array.isArray(response)) {
                const firstResponse: unknown = response[0];
                return firstResponse;
            }

            return response;
        } catch (error: unknown) {
            throw new TinEinValidationServiceError(
                "The TIN/EIN validation service could not be reached.",
                { cause: error },
            );
        }
    };
}

function readSoapMethod(
    soapClient: Record<string, unknown>,
    methodName: string,
): ValidationServiceInvoker {
    const method = soapClient[methodName];
    if (typeof method !== "function") {
        throw new TinEinValidationServiceError(
            `The TIN/EIN validation WSDL does not expose ${methodName}.`,
        );
    }

    return async (payload: unknown): Promise<unknown> => {
        const response: unknown = await Reflect.apply(method, soapClient, [
            payload,
        ]);

        return response;
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
        if (typeof value === "string" && value.trim().length > 0) {
            return value;
        }
    }

    return undefined;
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
