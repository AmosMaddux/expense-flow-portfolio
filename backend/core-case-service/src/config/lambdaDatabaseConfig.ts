import { SecretsManager } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const lambdaDatabaseEnvironmentSchema = z.object({
    DATABASE_SECRET_ARN: z.string().trim().min(1),
});

const lambdaDatabaseSecretSchema = z.object({
    database_url: z.string().trim().min(1),
});

export type LambdaDatabaseConfig = {
    databaseUrl: string;
};

/**
 * Resolves the database URL from AWS Secrets Manager using the provided secret ARN.
 * The secret must contain a JSON object with a "database_url" key.
 */
export async function loadLambdaDatabaseConfig(
    environment: NodeJS.ProcessEnv = process.env,
): Promise<LambdaDatabaseConfig> {
    const envParsed = lambdaDatabaseEnvironmentSchema.safeParse(environment);
    if (!envParsed.success) {
        throw new ConfigurationError(
            "Lambda database configuration is missing DATABASE_SECRET_ARN.",
            { cause: envParsed.error },
        );
    }

    const secretArn = envParsed.data.DATABASE_SECRET_ARN;
    const client = new SecretsManager();

    try {
        const response = await client.getSecretValue({ SecretId: secretArn });
        if (!response.SecretString) {
            throw new Error("Secret does not contain a SecretString value.");
        }

        const secretValue: unknown = JSON.parse(response.SecretString);
        const { database_url: databaseUrl } =
            lambdaDatabaseSecretSchema.parse(secretValue);

        // Validate that the URL is parseable
        new URL(databaseUrl);

        return { databaseUrl };
    } catch (error) {
        if (error instanceof Error && error.message.includes("Secret")) {
            throw error;
        }
        throw new ConfigurationError(
            "Failed to load database configuration from Secrets Manager.",
            { cause: error },
        );
    }
}

/**
 * Verifies DATABASE_SECRET_ARN is configured and accessible before DB-backed Lambda modules load.
 */
export async function verifyLambdaDatabaseUrlEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
    await loadLambdaDatabaseConfig(environment);
}
