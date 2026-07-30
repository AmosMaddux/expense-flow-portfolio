import { z } from "zod";

import {
    createSoapTinEinValidationClient,
    TinEinValidationRequestSchema,
    type TinEinValidationClient,
    type TinEinValidationResponse,
} from "./tinEinValidationClient.js";
import { TinEinValidationServiceError } from "./tinEinValidationErrors.js";

export const EinValidationRequestSchema = z
    .object({
        ein: TinEinValidationRequestSchema.shape.identifier,
        legalName: TinEinValidationRequestSchema.shape.legalName,
    })
    .strict();

export const EinValidationResultSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("valid"),
        isValid: z.literal(true),
        normalizedLegalName: z.string().min(1).optional(),
        serviceReferenceId: z.string().min(1).optional(),
    }),
    z.object({
        status: z.literal("invalid"),
        isValid: z.literal(false),
        rejectionReason: z.string().min(1).optional(),
        serviceReferenceId: z.string().min(1).optional(),
    }),
    z.object({
        status: z.literal("unreachable"),
        isValid: z.literal(false),
        rejectionReason: z.string().min(1),
    }),
]);

export type EinValidationRequest = z.infer<typeof EinValidationRequestSchema>;
export type EinValidationResult = z.infer<typeof EinValidationResultSchema>;

export type EinValidationAcl = {
    /**
     * Validates an EIN and returns a domain-safe result without SOAP details.
     */
    validateEin(request: EinValidationRequest): Promise<EinValidationResult>;
};

export type EinValidationAclOptions = {
    tinEinValidationClient?: TinEinValidationClient;
};

/**
 * Creates the anti-corruption layer for shared SOAP TIN/EIN validation.
 */
export function createEinValidationAcl(
    options: EinValidationAclOptions = {},
): EinValidationAcl {
    const client =
        options.tinEinValidationClient ?? createSoapTinEinValidationClient();

    return {
        async validateEin(
            request: EinValidationRequest,
        ): Promise<EinValidationResult> {
            const parsedRequest = EinValidationRequestSchema.parse(request);

            try {
                const response = await client.validateTinEin({
                    identifierType: "EIN",
                    identifier: parsedRequest.ein,
                    legalName: parsedRequest.legalName,
                });

                return toEinValidationResult(response);
            } catch (error: unknown) {
                if (isServiceUnavailableError(error)) {
                    return EinValidationResultSchema.parse({
                        status: "unreachable",
                        isValid: false,
                        rejectionReason:
                            "EIN validation is temporarily unavailable.",
                    });
                }

                throw error;
            }
        },
    };
}

function isServiceUnavailableError(
    error: unknown,
): error is TinEinValidationServiceError {
    if (error instanceof TinEinValidationServiceError) {
        return true;
    }

    if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
    ) {
        return [
            "ECONNABORTED",
            "ECONNREFUSED",
            "ECONNRESET",
            "EHOSTUNREACH",
            "ENETUNREACH",
            "ETIMEDOUT",
        ].includes(error.code);
    }

    return false;
}

function toEinValidationResult(
    response: TinEinValidationResponse,
): EinValidationResult {
    if (response.isValid) {
        return EinValidationResultSchema.parse({
            status: "valid",
            isValid: true,
            ...(response.normalizedLegalName === undefined
                ? {}
                : { normalizedLegalName: response.normalizedLegalName }),
            ...(response.serviceReferenceId === undefined
                ? {}
                : { serviceReferenceId: response.serviceReferenceId }),
        });
    }

    return EinValidationResultSchema.parse({
        status: "invalid",
        isValid: false,
        ...(response.rejectionReason === undefined
            ? {}
            : { rejectionReason: response.rejectionReason }),
        ...(response.serviceReferenceId === undefined
            ? {}
            : { serviceReferenceId: response.serviceReferenceId }),
    });
}
