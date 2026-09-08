import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";
import { loadDatabaseConfig } from "./databaseConfig.js";

void describe("loadDatabaseConfig", () => {
    void test("prefers DATABASE_URL when set", () => {
        const config = loadDatabaseConfig({
            DATABASE_URL:
                "postgres://synthetic-user@db.example.invalid:5432/expenseflow",
            DB_HOST: "should-be-ignored.example.invalid",
            DB_NAME: "should_be_ignored",
            DB_PASSWORD: "should-be-ignored",
            DB_PORT: "5432",
            DB_USERNAME: "should-be-ignored",
        });

        expect(config).toStrictEqual({
            connectionString:
                "postgres://synthetic-user@db.example.invalid:5432/expenseflow",
        });
    });

    void test("assembles a connection string from discrete DB_* env vars, requiring SSL", () => {
        const config = loadDatabaseConfig({
            DB_HOST: "db.example.invalid",
            DB_NAME: "expenseflow",
            DB_PASSWORD: "synthetic-password",
            DB_PORT: "5432",
            DB_USERNAME: "synthetic-user",
        });

        expect(config).toStrictEqual({
            connectionString:
                "postgres://synthetic-user:synthetic-password@db.example.invalid:5432/expenseflow?uselibpqcompat=true&sslmode=require",
        });
    });

    void test("URI-encodes special characters in username and password", () => {
        const config = loadDatabaseConfig({
            DB_HOST: "db.example.invalid",
            DB_NAME: "expenseflow",
            DB_PASSWORD: "p@ss:w/ord?#",
            DB_PORT: "5432",
            DB_USERNAME: "synthetic user",
        });

        expect(config).toStrictEqual({
            connectionString:
                "postgres://synthetic%20user:p%40ss%3Aw%2Ford%3F%23@db.example.invalid:5432/expenseflow?uselibpqcompat=true&sslmode=require",
        });
    });

    void test("rejects an empty environment", () => {
        expect(() => loadDatabaseConfig({})).toThrow(ConfigurationError);
    });

    void test("rejects a partial set of discrete DB_* env vars", () => {
        expect(() =>
            loadDatabaseConfig({
                DB_HOST: "db.example.invalid",
                DB_NAME: "expenseflow",
                DB_PORT: "5432",
                DB_USERNAME: "synthetic-user",
            }),
        ).toThrow(ConfigurationError);
    });

    void test("rejects a non-numeric DB_PORT", () => {
        expect(() =>
            loadDatabaseConfig({
                DB_HOST: "db.example.invalid",
                DB_NAME: "expenseflow",
                DB_PASSWORD: "synthetic-password",
                DB_PORT: "not-a-port",
                DB_USERNAME: "synthetic-user",
            }),
        ).toThrow(ConfigurationError);
    });
});
