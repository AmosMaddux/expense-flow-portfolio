import { describe, expect, test, vi } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import {
    loadLambdaDatabaseConfig,
    verifyLambdaDatabaseUrlEnvironment,
} from "./lambdaDatabaseConfig.js";

const synthethicDatabaseUrl =
    "postgres://synthetic-user@db.example.invalid:5432/expenseflow";
const syntheticSecretArn =
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:expenseflow-sandbox-database-url";

vi.mock("@aws-sdk/client-secrets-manager");

void describe("Lambda database configuration", () => {
    void test("loads database URL from Secrets Manager using SECRET_ARN", async () => {
        const { SecretsManager } =
            await import("@aws-sdk/client-secrets-manager");

        const mockGetSecretValue = vi
            .fn()
            .mockResolvedValue({
                SecretString: JSON.stringify({
                    database_url: synthethicDatabaseUrl,
                }),
            });

        vi.mocked(SecretsManager).mockImplementation(
            () =>
                ({
                    getSecretValue: mockGetSecretValue,
                }) as any,
        );

        const config = await loadLambdaDatabaseConfig({
            DATABASE_SECRET_ARN: syntheticSecretArn,
        });

        expect(config).toStrictEqual({
            databaseUrl: synthethicDatabaseUrl,
        });
        expect(mockGetSecretValue).toHaveBeenCalledWith({
            SecretId: syntheticSecretArn,
        });
    });

    void test("rejects missing DATABASE_SECRET_ARN", async () => {
        await expect(loadLambdaDatabaseConfig({})).rejects.toThrow(
            ConfigurationError,
        );
    });

    void test("rejects invalid database URLs from Secrets Manager", async () => {
        const { SecretsManager } =
            await import("@aws-sdk/client-secrets-manager");

        const mockGetSecretValue = vi
            .fn()
            .mockResolvedValue({
                SecretString: JSON.stringify({
                    database_url: "not-a-url",
                }),
            });

        vi.mocked(SecretsManager).mockImplementation(
            () =>
                ({
                    getSecretValue: mockGetSecretValue,
                }) as any,
        );

        await expect(
            loadLambdaDatabaseConfig({
                DATABASE_SECRET_ARN: syntheticSecretArn,
            }),
        ).rejects.toThrow(ConfigurationError);
    });
});
