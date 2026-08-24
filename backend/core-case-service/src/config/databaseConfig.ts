import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const databaseConfigSchema = z.union([
    z.object({
        DATABASE_URL: z.string().trim().min(1),
    }),
    z.object({
        DB_HOST: z.string().trim().min(1),
        DB_NAME: z.string().trim().min(1),
        DB_PASSWORD: z.string().min(1),
        DB_PORT: z.coerce.number().int().positive(),
        DB_USERNAME: z.string().trim().min(1),
    }),
]);

export type DatabaseConfig = {
    connectionString: string;
};

/**
 * Resolves the Postgres connection string, preferring DATABASE_URL (local/docker-compose)
 * and otherwise assembling it from the discrete RDS connection env vars ECS injects.
 */
export function loadDatabaseConfig(
    environment: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
    const parsed = databaseConfigSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Database connection is not configured. Set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD.",
            { cause: parsed.error },
        );
    }

    if ("DATABASE_URL" in parsed.data) {
        return { connectionString: parsed.data.DATABASE_URL };
    }

    const { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USERNAME } =
        parsed.data;
    const encodedUsername = encodeURIComponent(DB_USERNAME);
    const encodedPassword = encodeURIComponent(DB_PASSWORD);

    return {
        connectionString: `postgres://${encodedUsername}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}?uselibpqcompat=true&sslmode=require`,
    };
}
