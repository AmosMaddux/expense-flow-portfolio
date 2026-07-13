import { z } from "zod";

import {
    passwordHashAlgorithm,
    type PasswordHasher,
} from "./passwordHasher.js";

export const registrationRequestSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    password: z.string().min(1),
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;

export type StoredCredential = {
    tenantId: string;
    userId: string;
    passwordHash: string;
    passwordHashAlgorithm: typeof passwordHashAlgorithm;
};

export type CredentialRepository = {
    create(credential: StoredCredential): Promise<void>;
};

export type RegistrationService = {
    register(request: RegistrationRequest): Promise<void>;
};

/**
 * Creates registrations that persist only an argon2id password hash.
 */
export function createRegistrationService(
    credentialRepository: CredentialRepository,
    passwordHasher: PasswordHasher,
): RegistrationService {
    return {
        async register(request: RegistrationRequest): Promise<void> {
            const validatedRequest = registrationRequestSchema.parse(request);
            const passwordHash = await passwordHasher.hashPassword(
                validatedRequest.password,
            );

            await credentialRepository.create({
                tenantId: validatedRequest.tenantId,
                userId: validatedRequest.userId,
                passwordHash,
                passwordHashAlgorithm,
            });
        },
    };
}
