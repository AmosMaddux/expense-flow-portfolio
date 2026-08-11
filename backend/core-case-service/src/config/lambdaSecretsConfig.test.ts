import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import {
    hydrateLambdaDatabaseUrlEnvironment,
    loadLambdaDatabaseSecretConfig,
    loadLambdaDatabaseUrlFromSecrets,
    resetLambdaDatabaseUrlCacheForTests,
} from "./lambdaSecretsConfig.js";

const databaseUrl =
    "postgres://synthetic-user:synthetic-password@db.example.invalid:5432/expenseflow";

function createSecretsClient(secretString: string | undefined = databaseUrl) {
    return {
        send: vi.fn().mockResolvedValue({ SecretString: secretString }),
    };
}

function createSecretsClientWithoutString() {
    return {
        send: vi.fn().mockResolvedValue({}),
    };
}

void describe("Lambda Secrets Manager configuration", () => {
    afterEach(() => {
        resetLambdaDatabaseUrlCacheForTests();
    });

    void test("loads the database secret identifier from the environment", () => {
        expect(
            loadLambdaDatabaseSecretConfig({
                AWS_REGION: "us-east-1",
                DATABASE_URL_SECRET_ID:
                    "expenseflow/sandbox/core-case/database-url",
            }),
        ).toStrictEqual({
            AWS_REGION: "us-east-1",
            DATABASE_URL_SECRET_ID:
                "expenseflow/sandbox/core-case/database-url",
        });
    });

    void test("rejects missing database secret identifier", () => {
        expect(() => loadLambdaDatabaseSecretConfig({})).toThrow(
            ConfigurationError,
        );
    });

    void test("fetches and caches the database URL secret", async () => {
        const client = createSecretsClient();

        await expect(
            loadLambdaDatabaseUrlFromSecrets(
                {
                    AWS_REGION: "us-east-1",
                    DATABASE_URL_SECRET_ID:
                        "expenseflow/sandbox/core-case/database-url",
                },
                client,
            ),
        ).resolves.toBe(databaseUrl);
        await expect(
            loadLambdaDatabaseUrlFromSecrets(
                {
                    AWS_REGION: "us-east-1",
                    DATABASE_URL_SECRET_ID:
                        "expenseflow/sandbox/core-case/database-url",
                },
                client,
            ),
        ).resolves.toBe(databaseUrl);

        expect(client.send).toHaveBeenCalledOnce();
        expect(client.send.mock.calls[0]?.[0]).toBeInstanceOf(
            GetSecretValueCommand,
        );
    });

    void test("hydrates DATABASE_URL from Secrets Manager", async () => {
        const environment: NodeJS.ProcessEnv = {
            AWS_REGION: "us-east-1",
            DATABASE_URL_SECRET_ID:
                "expenseflow/sandbox/core-case/database-url",
        };

        await hydrateLambdaDatabaseUrlEnvironment(
            environment,
            createSecretsClient(),
        );

        expect(environment.DATABASE_URL).toBe(databaseUrl);
    });

    void test("rejects missing secret string without exposing a secret", async () => {
        const client = createSecretsClientWithoutString();

        await expect(
            loadLambdaDatabaseUrlFromSecrets(
                {
                    AWS_REGION: "us-east-1",
                    DATABASE_URL_SECRET_ID:
                        "expenseflow/sandbox/core-case/database-url",
                },
                client,
            ),
        ).rejects.toThrow("Lambda database secret is missing a string value.");
    });

    void test("rejects invalid secret strings without exposing the value", async () => {
        const client = createSecretsClient("not-a-url");

        await expect(
            loadLambdaDatabaseUrlFromSecrets(
                {
                    AWS_REGION: "us-east-1",
                    DATABASE_URL_SECRET_ID:
                        "expenseflow/sandbox/core-case/database-url",
                },
                client,
            ),
        ).rejects.toThrow("Lambda database secret is invalid.");
        await expect(
            loadLambdaDatabaseUrlFromSecrets(
                {
                    AWS_REGION: "us-east-1",
                    DATABASE_URL_SECRET_ID:
                        "expenseflow/sandbox/core-case/database-url",
                },
                client,
            ),
        ).rejects.not.toThrow("not-a-url");
    });
});
