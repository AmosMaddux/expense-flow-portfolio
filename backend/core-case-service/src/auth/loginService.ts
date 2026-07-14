import { z } from "zod";

import { InvalidCredentialsError } from "./authenticationErrors.js";
import {
    passwordHashAlgorithm,
    type PasswordHasher,
} from "./passwordHasher.js";

export const loginRequestSchema = z.object({
    tenantId: z.uuid(),
    email: z.email(),
    password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

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

export type LoginResult = {
    tenantId: string;
    userId: string;
    mfaRequired: true;
};

export type LoginService = {
    login(request: LoginRequest): Promise<LoginResult>;
};

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

            if (storedCredential === undefined) {
                await recordFailedLogin(loginCredentialRepository, {
                    tenantId: validatedRequest.tenantId,
                    userId: null,
                    email: normalizedEmail,
                    action: "login_failed",
                });
                throw new InvalidCredentialsError();
            }

            const passwordMatches =
                storedCredential.passwordHashAlgorithm ===
                    passwordHashAlgorithm &&
                (await passwordHasher.verifyPassword(
                    storedCredential.passwordHash,
                    validatedRequest.password,
                ));

            if (!passwordMatches) {
                await recordFailedLogin(loginCredentialRepository, {
                    tenantId: storedCredential.tenantId,
                    userId: storedCredential.userId,
                    email: normalizedEmail,
                    action: "login_failed",
                });
                throw new InvalidCredentialsError();
            }

            return {
                tenantId: storedCredential.tenantId,
                userId: storedCredential.userId,
                mfaRequired: true,
            };
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
