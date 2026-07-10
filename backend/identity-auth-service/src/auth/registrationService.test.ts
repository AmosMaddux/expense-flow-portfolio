import { describe, expect, test, vi } from "vitest";

import { createPasswordHasher } from "./passwordHasher.js";
import {
    createRegistrationService,
    type CredentialRepository,
    type StoredCredential,
} from "./registrationService.js";

const testHashConfig = {
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
    hashLength: 32,
};

void describe("registration service", () => {
    void test("stores an argon2id hash that verifies instead of plaintext", async () => {
        const plaintextPassword = "synthetic-registration-password";
        let storedCredential: StoredCredential | undefined;
        const credentialRepository: CredentialRepository = {
            create: vi.fn(async (credential: StoredCredential) => {
                storedCredential = credential;
            }),
        };
        const passwordHasher = createPasswordHasher(testHashConfig);
        const registrationService = createRegistrationService(
            credentialRepository,
            passwordHasher,
        );

        await registrationService.register({
            tenantId: "00000000-0000-4000-8000-000000000301",
            userId: "10000000-0000-4000-8000-000000000301",
            password: plaintextPassword,
        });

        expect(storedCredential).toBeDefined();
        expect(storedCredential?.passwordHash).not.toEqual(plaintextPassword);
        expect(storedCredential?.passwordHash).toMatch(/^\$argon2id\$/);
        expect(storedCredential?.passwordHash).toContain("m=8192,t=1,p=1");
        expect(storedCredential?.passwordHashAlgorithm).toEqual("argon2id");
        await expect(
            passwordHasher.verifyPassword(
                storedCredential?.passwordHash ?? "",
                plaintextPassword,
            ),
        ).resolves.toBeTruthy();
        await expect(
            passwordHasher.verifyPassword(
                storedCredential?.passwordHash ?? "",
                "incorrect-synthetic-password",
            ),
        ).resolves.toBeFalsy();
    });
});
