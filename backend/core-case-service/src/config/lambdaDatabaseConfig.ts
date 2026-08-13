import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const lambdaDatabaseEnvironmentSchema = z.object({
    DATABASE_URL: z.string().trim().min(1).url(),
});

export type LambdaDatabaseConfig = z.infer<
    typeof lambdaDatabaseEnvironmentSchema
>;

/**
 * Loads the resolved database URL required by DB-backed Lambda handlers.
 */
export function loadLambdaDatabaseConfig(
    environment: NodeJS.ProcessEnv = process.env,
): LambdaDatabaseConfig {
    const parsed = lambdaDatabaseEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Lambda database configuration is invalid.",
            { cause: parsed.error },
        );
    }

    return parsed.data;
}

/**
 * Verifies DATABASE_URL is already resolved before DB-backed Lambda modules load.
 */
export function verifyLambdaDatabaseUrlEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): void {
    loadLambdaDatabaseConfig(environment);
}
