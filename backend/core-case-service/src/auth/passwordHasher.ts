import { argon2id, hash, verify } from "argon2";

import type { PasswordHashConfig } from "../config/passwordHashConfig.js";

export const passwordHashAlgorithm = "argon2id";

export type PasswordHasher = {
    hashPassword(password: string): Promise<string>;
    verifyPassword(passwordHash: string, password: string): Promise<boolean>;
};

/**
 * Creates an argon2id password hasher using the supplied cost parameters.
 */
export function createPasswordHasher(
    config: PasswordHashConfig,
): PasswordHasher {
    return {
        async hashPassword(password: string): Promise<string> {
            return await hash(password, {
                type: argon2id,
                memoryCost: config.memoryCost,
                timeCost: config.timeCost,
                parallelism: config.parallelism,
                hashLength: config.hashLength,
            });
        },
        async verifyPassword(
            passwordHash: string,
            password: string,
        ): Promise<boolean> {
            return await verify(passwordHash, password);
        },
    };
}
