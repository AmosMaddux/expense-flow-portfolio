import { describe, expect, test, vi } from "vitest";

import {
    createTotpSecretProtector,
    loadMfaTotpSecretEncryptionConfig,
} from "./totpSecretProtector.js";

const key = Buffer.from("00000000000000000000000000000000").toString("base64");

void describe("TOTP secret protector", () => {
    void test("encrypts and decrypts a TOTP secret", () => {
        const protector = createTotpSecretProtector(() =>
            loadMfaTotpSecretEncryptionConfig({
                MFA_TOTP_SECRET_ENCRYPTION_KEY: key,
                MFA_TOTP_SECRET_KEY_VERSION: "synthetic-v1",
            }),
        );
        const secret = "SYNTHETICTOTPSECRET";

        const protectedSecret = protector.protect(Buffer.from(secret, "utf8"));

        expect(protectedSecret.secretCiphertext).not.toEqual(secret);
        expect(protectedSecret.secretKeyVersion).toBe("synthetic-v1");
        expect(protector.reveal(protectedSecret).toString("utf8")).toBe(secret);
    });

    void test("loads encryption config when the protector is created", () => {
        expect(() =>
            createTotpSecretProtector(() =>
                loadMfaTotpSecretEncryptionConfig({}),
            ),
        ).toThrow("MFA_TOTP_SECRET_ENCRYPTION_KEY is required.");
    });

    void test("reuses the resolved encryption config for protect and reveal", () => {
        const configProvider = vi.fn(() =>
            loadMfaTotpSecretEncryptionConfig({
                MFA_TOTP_SECRET_ENCRYPTION_KEY: key,
                MFA_TOTP_SECRET_KEY_VERSION: "synthetic-v1",
            }),
        );
        const protector = createTotpSecretProtector(configProvider);
        const protectedSecret = protector.protect("SYNTHETICTOTPSECRET");

        protector.reveal(protectedSecret);

        expect(configProvider).toHaveBeenCalledOnce();
    });

    void test("rejects an authentication tag shorter than 128 bits", () => {
        const protector = createTotpSecretProtector(() =>
            loadMfaTotpSecretEncryptionConfig({
                MFA_TOTP_SECRET_ENCRYPTION_KEY: key,
                MFA_TOTP_SECRET_KEY_VERSION: "synthetic-v1",
            }),
        );
        const protectedSecret = protector.protect("SYNTHETICTOTPSECRET");

        expect(() =>
            protector.reveal({
                ...protectedSecret,
                secretAuthTag: Buffer.from("short-tag").toString("base64"),
            }),
        ).toThrow();
    });

    void test("rejects a missing encryption key", () => {
        expect(() => loadMfaTotpSecretEncryptionConfig({})).toThrow(
            "MFA_TOTP_SECRET_ENCRYPTION_KEY is required.",
        );
    });

    void test("rejects an encryption key with the wrong length", () => {
        expect(() =>
            loadMfaTotpSecretEncryptionConfig({
                MFA_TOTP_SECRET_ENCRYPTION_KEY:
                    Buffer.from("too-short").toString("base64"),
            }),
        ).toThrow(
            "MFA_TOTP_SECRET_ENCRYPTION_KEY must be a 32-byte base64 value.",
        );
    });
});
