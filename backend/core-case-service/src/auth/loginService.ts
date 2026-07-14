import { z } from "zod";

import { InvalidCredentialsError } from "./authenticationErrors.js";
import {
    passwordHashAlgorithm,
    type PasswordHasher,
} from "./passwordHasher.js";

export const LoginInboundRequestSchema = z.object({
    tenantId: z.uuid(),
    email: z.email(),
    password: z.string().min(1),
});

export const LoginOutboundResponseSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    mfaRequired: z.literal(true),
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
    action: "login_failed";
};

export type LoginCredentialRepository = {
    findByTenantAndEmail(
        tenantId: string,
        email: string,
    ): Promise<StoredLoginCredential | undefined>;
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

            return LoginOutboundResponseSchema.parse({
                tenantId: storedCredential.tenantId,
                userId: storedCredential.userId,
                mfaRequired: true,
            });
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
