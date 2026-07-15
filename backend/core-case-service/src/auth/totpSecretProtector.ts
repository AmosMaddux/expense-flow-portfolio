import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    type CipherGCMTypes,
} from "node:crypto";

const encryptionAlgorithm: CipherGCMTypes = "aes-256-gcm";
const requiredKeyBytes = 32;
const ivBytes = 12;

export type MfaTotpSecretEncryptionConfig = {
    key: Buffer;
    keyVersion: string;
};

export type ProtectedTotpSecret = {
    secretCiphertext: string;
    secretIv: string;
    secretAuthTag: string;
    secretKeyVersion: string;
};

export type TotpSecretProtector = {
    protect(secret: Buffer | string): ProtectedTotpSecret;
    reveal(protectedSecret: ProtectedTotpSecret): Buffer;
};

/**
 * Loads the encryption key used to protect TOTP enrollment secrets at rest.
 */
export function loadMfaTotpSecretEncryptionConfig(
    env: NodeJS.ProcessEnv = process.env,
): MfaTotpSecretEncryptionConfig {
    const encodedKey = env.MFA_TOTP_SECRET_ENCRYPTION_KEY;

    if (encodedKey === undefined || encodedKey.length === 0) {
        throw new Error("MFA_TOTP_SECRET_ENCRYPTION_KEY is required.");
    }

    const key = Buffer.from(encodedKey, "base64");

    if (key.byteLength !== requiredKeyBytes) {
        throw new Error(
            "MFA_TOTP_SECRET_ENCRYPTION_KEY must be a 32-byte base64 value.",
        );
    }

    const keyVersion = env.MFA_TOTP_SECRET_KEY_VERSION ?? "v1";

    if (keyVersion.trim().length === 0) {
        throw new Error("MFA_TOTP_SECRET_KEY_VERSION cannot be blank.");
    }

    return {
        key,
        keyVersion,
    };
}

/**
 * Creates an AES-GCM protector for TOTP enrollment secrets.
 */
export function createTotpSecretProtector(
    configProvider: () => MfaTotpSecretEncryptionConfig = loadMfaTotpSecretEncryptionConfig,
): TotpSecretProtector {
    const { key, keyVersion } = configProvider();

    return {
        protect(secret: Buffer | string): ProtectedTotpSecret {
            const iv = randomBytes(ivBytes);
            const cipher = createCipheriv(encryptionAlgorithm, key, iv);
            const ciphertext = Buffer.concat([
                cipher.update(secret),
                cipher.final(),
            ]);

            return {
                secretCiphertext: ciphertext.toString("base64"),
                secretIv: iv.toString("base64"),
                secretAuthTag: cipher.getAuthTag().toString("base64"),
                secretKeyVersion: keyVersion,
            };
        },
        reveal(protectedSecret: ProtectedTotpSecret): Buffer {
            const decipher = createDecipheriv(
                encryptionAlgorithm,
                key,
                Buffer.from(protectedSecret.secretIv, "base64"),
            );
            decipher.setAuthTag(
                Buffer.from(protectedSecret.secretAuthTag, "base64"),
            );

            return Buffer.concat([
                decipher.update(
                    Buffer.from(protectedSecret.secretCiphertext, "base64"),
                ),
                decipher.final(),
            ]);
        },
    };
}
