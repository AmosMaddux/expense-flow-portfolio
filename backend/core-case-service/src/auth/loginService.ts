import { createHmac, createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
    InvalidCredentialsError,
    InvalidMfaCodeError,
} from "./authenticationErrors.js";
import {
    passwordHashAlgorithm,
    type PasswordHasher,
} from "./passwordHasher.js";
import type {
    ProtectedTotpSecret,
    TotpSecretProtector,
} from "./totpSecretProtector.js";

export const LoginInboundRequestSchema = z.object({
    tenantId: z.uuid(),
    email: z.email(),
    password: z.string().min(1),
    totpCode: z.string().optional(),
});

export const LoginOutboundResponseSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    refreshToken: z.string().min(1),
    refreshTokenExpiresAt: z.string().min(1),
});

export const loginRequestSchema = LoginInboundRequestSchema;
export const loginResponseSchema = LoginOutboundResponseSchema;

export type LoginRequest = z.infer<typeof LoginInboundRequestSchema>;

export type StoredLoginCredential = {
    tenantId: string;
    userId: string;
    email: string;
    passwordHash: string;
    passwordHashAlgorithm: string;
};

export type FailedLoginAuditEntry = {
    tenantId: string;
    userId: string | null;
    email: string;
    action: "login_failed" | "mfa_failed";
};

export type StoredMfaLoginEnrollment = ProtectedTotpSecret & {
    algorithm: "SHA1";
    digits: 6 | 8;
    periodSeconds: number;
};

export type LoginCredentialRepository = {
    findByTenantAndEmail(
        tenantId: string,
        email: string,
    ): Promise<StoredLoginCredential | undefined>;
    findMfaEnrollmentByTenantAndUser(
        tenantId: string,
        userId: string,
    ): Promise<StoredMfaLoginEnrollment | undefined>;
    createRefreshToken(token: {
        tenantId: string;
        userId: string;
        tokenHash: string;
        expiresAt: Date;
    }): Promise<void>;
    recordFailedLogin(entry: FailedLoginAuditEntry): Promise<void>;
};

export type LoginResult = z.infer<typeof LoginOutboundResponseSchema>;

export type LoginService = {
    login(request: LoginRequest): Promise<LoginResult>;
};

const missingCredentialPasswordHash =
    "$argon2id$v=19$m=8192,t=1,p=1$Wa0FFWwch77sS6ipFg2HTQ$In6nZwlC0DltjYKUVVtpL4cg2i8GnqrnEYGfHnlWCdw";

/**
 * Creates a login service that verifies primary credentials before MFA.
 */
export function createLoginService(
    loginCredentialRepository: LoginCredentialRepository,
    passwordHasher: PasswordHasher,
    totpSecretProtector: TotpSecretProtector,
    now: () => Date = () => new Date(),
): LoginService {
    return {
        async login(request: LoginRequest): Promise<LoginResult> {
            const validatedRequest = loginRequestSchema.parse(request);
            const normalizedEmail = normalizeEmail(validatedRequest.email);
            const storedCredential =
                await loginCredentialRepository.findByTenantAndEmail(
                    validatedRequest.tenantId,
                    normalizedEmail,
                );

            const passwordHashToVerify =
                storedCredential?.passwordHashAlgorithm ===
                passwordHashAlgorithm
                    ? storedCredential.passwordHash
                    : missingCredentialPasswordHash;
            // Always perform one Argon2 verification so unknown emails and bad passwords have similar timing.
            const verifiedPassword = await passwordHasher.verifyPassword(
                passwordHashToVerify,
                validatedRequest.password,
            );
            const passwordMatches =
                storedCredential !== undefined &&
                storedCredential.passwordHashAlgorithm ===
                    passwordHashAlgorithm &&
                verifiedPassword;

            if (!passwordMatches) {
                await recordFailedLogin(loginCredentialRepository, {
                    tenantId:
                        storedCredential?.tenantId ??
                        validatedRequest.tenantId,
                    userId: storedCredential?.userId ?? null,
                    email: normalizedEmail,
                    action: "login_failed",
                });
                throw new InvalidCredentialsError();
            }

            const storedEnrollment =
                await loginCredentialRepository.findMfaEnrollmentByTenantAndUser(
                    storedCredential.tenantId,
                    storedCredential.userId,
                );

            if (storedEnrollment === undefined) {
                return issueRefreshToken(
                    loginCredentialRepository,
                    storedCredential,
                    now(),
                );
            }

            if (
                validatedRequest.totpCode === undefined ||
                !/^\d{6,8}$/.test(validatedRequest.totpCode) ||
                !verifyTotpCode(
                    totpSecretProtector
                        .reveal(storedEnrollment)
                        .toString("utf8"),
                    validatedRequest.totpCode,
                    storedEnrollment,
                    now(),
                )
            ) {
                await recordFailedLogin(loginCredentialRepository, {
                    tenantId: storedCredential.tenantId,
                    userId: storedCredential.userId,
                    email: normalizedEmail,
                    action: "mfa_failed",
                });
                throw new InvalidMfaCodeError();
            }

            return issueRefreshToken(
                loginCredentialRepository,
                storedCredential,
                now(),
            );
        },
    };
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

async function recordFailedLogin(
    loginCredentialRepository: LoginCredentialRepository,
    entry: FailedLoginAuditEntry,
): Promise<void> {
    await loginCredentialRepository.recordFailedLogin(entry);
}

async function issueRefreshToken(
    loginCredentialRepository: LoginCredentialRepository,
    storedCredential: StoredLoginCredential,
    currentTime: Date,
): Promise<LoginResult> {
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshTokenExpiresAt = new Date(
        currentTime.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    await loginCredentialRepository.createRefreshToken({
        tenantId: storedCredential.tenantId,
        userId: storedCredential.userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
    });

    return LoginOutboundResponseSchema.parse({
        tenantId: storedCredential.tenantId,
        userId: storedCredential.userId,
        refreshToken,
        refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    });
}

function verifyTotpCode(
    secret: string,
    code: string,
    enrollment: StoredMfaLoginEnrollment,
    currentTime: Date,
): boolean {
    const counter = Math.floor(
        currentTime.getTime() / 1000 / enrollment.periodSeconds,
    );
    const secretBytes = decodeBase32(secret);

    for (let offset = -1; offset <= 1; offset += 1) {
        if (
            generateTotpCode(
                secretBytes,
                counter + offset,
                enrollment.digits,
            ) ===
            code
        ) {
            return true;
        }
    }

    return false;
}

function generateTotpCode(
    secretBytes: Buffer,
    counter: number,
    digits: 6 | 8,
): string {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac("sha1", secretBytes)
        .update(counterBuffer)
        .digest();
    const offset = readByte(hmac, hmac.length - 1) & 0x0f;
    const binary =
        ((readByte(hmac, offset) & 0x7f) << 24) |
        ((readByte(hmac, offset + 1) & 0xff) << 16) |
        ((readByte(hmac, offset + 2) & 0xff) << 8) |
        (readByte(hmac, offset + 3) & 0xff);

    return (binary % 10 ** digits).toString().padStart(digits, "0");
}

function readByte(bytes: Buffer, index: number): number {
    const byte = bytes[index];

    if (byte === undefined) {
        throw new Error("TOTP digest was shorter than expected.");
    }

    return byte;
}

function decodeBase32(secret: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;

    for (const character of secret.replaceAll("=", "").toUpperCase()) {
        const index = alphabet.indexOf(character);

        if (index === -1) {
            throw new InvalidMfaCodeError();
        }

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
}
