import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const lambdaSecretsEnvironmentSchema = z.object({
    AWS_REGION: z.string().trim().min(1).default("us-east-1"),
    DATABASE_URL_SECRET_ID: z.string().trim().min(1),
});

const databaseUrlSecretSchema = z.string().trim().min(1).url();

type SecretsManagerCommandClient = Pick<SecretsManagerClient, "send">;

export type LambdaDatabaseSecretConfig = z.infer<
    typeof lambdaSecretsEnvironmentSchema
>;

let cachedDatabaseUrl: string | undefined;

/**
 * Loads the database secret identifier used by Core Case Lambda handlers.
 */
export function loadLambdaDatabaseSecretConfig(
    environment: NodeJS.ProcessEnv = process.env,
): LambdaDatabaseSecretConfig {
    const parsed = lambdaSecretsEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Lambda database secret configuration is invalid.",
            { cause: parsed.error },
        );
    }

    return parsed.data;
}

/**
 * Fetches and caches the Core Case database URL from Secrets Manager.
 */
export async function loadLambdaDatabaseUrlFromSecrets(
    environment: NodeJS.ProcessEnv = process.env,
    client?: SecretsManagerCommandClient,
): Promise<string> {
    if (cachedDatabaseUrl !== undefined) {
        return cachedDatabaseUrl;
    }

    const config = loadLambdaDatabaseSecretConfig(environment);
    const secretsClient =
        client ?? new SecretsManagerClient({ region: config.AWS_REGION });
    const response = await secretsClient.send(
        new GetSecretValueCommand({
            SecretId: config.DATABASE_URL_SECRET_ID,
        }),
    );

    if (response.SecretString === undefined) {
        throw new ConfigurationError(
            "Lambda database secret is missing a string value.",
        );
    }

    const parsedSecret = databaseUrlSecretSchema.safeParse(
        response.SecretString,
    );
    if (!parsedSecret.success) {
        throw new ConfigurationError("Lambda database secret is invalid.", {
            cause: parsedSecret.error,
        });
    }

    cachedDatabaseUrl = parsedSecret.data;

    return cachedDatabaseUrl;
}

/**
 * Hydrates DATABASE_URL before DB-backed Lambda modules are loaded.
 */
export async function hydrateLambdaDatabaseUrlEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    client?: SecretsManagerCommandClient,
): Promise<void> {
    environment.DATABASE_URL = await loadLambdaDatabaseUrlFromSecrets(
        environment,
        client,
    );
}

/**
 * Clears module-level secret cache for tests that need isolated fetch behavior.
 */
export function resetLambdaDatabaseUrlCacheForTests(): void {
    cachedDatabaseUrl = undefined;
}
