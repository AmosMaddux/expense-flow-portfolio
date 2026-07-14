import { z } from "zod";

const passwordHashEnvironmentSchema = z.object({
    ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
    ARGON2_HASH_LENGTH: z.coerce.number().int().min(16).default(32),
});

export type PasswordHashConfig = {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
    hashLength: number;
};

/**
 * Reads and validates argon2id parameters from the service environment.
 */
export function loadPasswordHashConfig(
    environment: NodeJS.ProcessEnv = process.env,
): PasswordHashConfig {
    const parsedEnvironment = passwordHashEnvironmentSchema.parse(environment);

    return {
        memoryCost: parsedEnvironment.ARGON2_MEMORY_COST,
        timeCost: parsedEnvironment.ARGON2_TIME_COST,
        parallelism: parsedEnvironment.ARGON2_PARALLELISM,
        hashLength: parsedEnvironment.ARGON2_HASH_LENGTH,
    };
}
