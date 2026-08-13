import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import {
    loadLambdaDatabaseConfig,
    verifyLambdaDatabaseUrlEnvironment,
} from "./lambdaDatabaseConfig.js";

const databaseUrl =
    "postgres://synthetic-user@db.example.invalid:5432/expenseflow";

void describe("Lambda database configuration", () => {
    void test("loads a resolved database URL from the environment", () => {
        expect(
            loadLambdaDatabaseConfig({ DATABASE_URL: databaseUrl }),
        ).toStrictEqual({
            DATABASE_URL: databaseUrl,
        });
    });

    void test("rejects missing database URLs", () => {
        expect(() => loadLambdaDatabaseConfig({})).toThrow(ConfigurationError);
    });

    void test("rejects unresolved dynamic references", () => {
        expect(() =>
            verifyLambdaDatabaseUrlEnvironment({
                DATABASE_URL:
                    "{{resolve:secretsmanager:expenseflow/sandbox/core-case/database-url:SecretString:DATABASE_URL}}",
            }),
        ).toThrow(ConfigurationError);
    });

    void test("keeps Secrets Manager SDK reads out of the Lambda app", () => {
        const source = readFileSync(
            fileURLToPath(
                new URL("./lambdaDatabaseConfig.ts", import.meta.url),
            ),
            "utf8",
        );

        expect(source).not.toContain("GetSecretValueCommand");
        expect(source).not.toContain("@aws-sdk/client-secrets-manager");
        expect(source).not.toContain("DATABASE_URL_SECRET_ID");
    });
});
