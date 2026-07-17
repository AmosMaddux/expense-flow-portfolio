import { describe, expect, test } from "vitest";

import { loadPasswordHashConfig } from "./passwordHashConfig.js";

void describe("password hash configuration", () => {
    void test("loads argon2id parameters from the environment", () => {
        expect(
            loadPasswordHashConfig({
                ARGON2_MEMORY_COST: "24576",
                ARGON2_TIME_COST: "3",
                ARGON2_PARALLELISM: "2",
                ARGON2_HASH_LENGTH: "48",
            }),
        ).toEqual({
            memoryCost: 24576,
            timeCost: 3,
            parallelism: 2,
            hashLength: 48,
        });
    });

    void test("rejects invalid argon2id parameters", () => {
        expect(() =>
            loadPasswordHashConfig({ ARGON2_MEMORY_COST: "0" }),
        ).toThrow();
    });
});
