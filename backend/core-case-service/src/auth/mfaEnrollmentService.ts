import { randomBytes } from "node:crypto";

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import type {
    ProtectedTotpSecret,
    TotpSecretProtector,
} from "./totpSecretProtector.js";

const issuer = "ExpenseFlow";
const totpAlgorithm = "SHA1";
const totpDigits = 6;
const totpPeriodSeconds = 30;
const secretBytes = 20;
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

extendZodWithOpenApi(z);

export const mfaEnrollmentRequestSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    email: z.email(),
});

export const mfaEnrollmentResponseSchema = z.object({
    provisioningUri: z.string().startsWith("otpauth://totp/"),
});

export type MfaEnrollmentRequest = z.infer<typeof mfaEnrollmentRequestSchema>;

export type MfaEnrollmentResponse = z.infer<typeof mfaEnrollmentResponseSchema>;

export type StoredMfaEnrollment = ProtectedTotpSecret & {
    tenantId: string;
    userId: string;
    algorithm: typeof totpAlgorithm;
    digits: typeof totpDigits;
    periodSeconds: typeof totpPeriodSeconds;
};

export type MfaEnrollmentRepository = {
    create(enrollment: StoredMfaEnrollment): Promise<void>;
};

export type MfaEnrollmentService = {
    enroll(request: MfaEnrollmentRequest): Promise<MfaEnrollmentResponse>;
};

/**
 * Creates MFA enrollments with protected TOTP secrets and provisioning URIs.
 */
export function createMfaEnrollmentService(
    mfaEnrollmentRepository: MfaEnrollmentRepository,
    totpSecretProtector: TotpSecretProtector,
): MfaEnrollmentService {
    return {
        async enroll(
            request: MfaEnrollmentRequest,
        ): Promise<MfaEnrollmentResponse> {
            const validatedRequest = mfaEnrollmentRequestSchema.parse(request);
            const normalizedEmail = normalizeEmail(validatedRequest.email);
            const secret = encodeBase32(randomBytes(secretBytes));
            const protectedSecret = totpSecretProtector.protect(
                Buffer.from(secret, "utf8"),
            );

            await mfaEnrollmentRepository.create({
                tenantId: validatedRequest.tenantId,
                userId: validatedRequest.userId,
                ...protectedSecret,
                algorithm: totpAlgorithm,
                digits: totpDigits,
                periodSeconds: totpPeriodSeconds,
            });

            return {
                provisioningUri: buildProvisioningUri(normalizedEmail, secret),
            };
        },
    };
}

function buildProvisioningUri(email: string, secret: string): string {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
    const params = new URLSearchParams({
        secret,
        issuer,
        algorithm: totpAlgorithm,
        digits: totpDigits.toString(),
        period: totpPeriodSeconds.toString(),
    });

    return `otpauth://totp/${label}?${params.toString()}`;
}

function encodeBase32(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = "";

    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            output += base32Alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += base32Alphabet[(value << (5 - bits)) & 31];
    }

    return output;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}
