import { createHmac, createPrivateKey } from "node:crypto";

import { base32 } from "rfc4648";

import { createLoginService } from "../../backend/core-case-service/dist/auth/login/loginService.js";

const [
    ,
    ,
    privateKeyBase64,
    keyId,
    issuer,
    issuedAtOffsetSeconds,
    accessTokenTtlSeconds,
] = process.argv;

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const email = "employee@example.invalid";
const password = "synthetic-login-password";
const syntheticTotpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const now = new Date(Date.now() + Number(issuedAtOffsetSeconds) * 1000);

const repository = {
    async findByTenantAndEmail(requestTenantId, requestEmail) {
        if (requestTenantId !== tenantId || requestEmail !== email) {
            return undefined;
        }

        return {
            tenantId,
            userId,
            email,
            passwordHash: "synthetic-password-hash",
            passwordHashAlgorithm: "argon2id",
            roles: ["Employee"],
        };
    },
    async findMfaEnrollmentByTenantAndUser(requestTenantId, requestUserId) {
        if (requestTenantId !== tenantId || requestUserId !== userId) {
            return undefined;
        }

        return {
            secretCiphertext: "synthetic-ciphertext",
            secretIv: "synthetic-iv",
            secretAuthTag: "synthetic-auth-tag",
            secretKeyVersion: "synthetic-key-v1",
            algorithm: "SHA1",
            digits: 8,
            periodSeconds: 30,
        };
    },
    async createRefreshToken() {},
    async recordFailedLogin() {},
};

const passwordHasher = {
    async hashPassword() {
        return "synthetic-password-hash";
    },
    async verifyPassword() {
        return true;
    },
};

const totpSecretProtector = {
    protect() {
        return {
            secretCiphertext: "synthetic-ciphertext",
            secretIv: "synthetic-iv",
            secretAuthTag: "synthetic-auth-tag",
            secretKeyVersion: "synthetic-key-v1",
        };
    },
    reveal() {
        return Buffer.from(syntheticTotpSecret, "utf8");
    },
};

const loginService = createLoginService(
    repository,
    passwordHasher,
    totpSecretProtector,
    {
        issuer,
        privateKey: createPrivateKey(
            Buffer.from(privateKeyBase64, "base64").toString("utf8"),
        ),
        ...(keyId === "__none__" ? {} : { keyId }),
        accessTokenTtlSeconds: Number(accessTokenTtlSeconds),
    },
    () => now,
);

const result = await loginService.login({
    tenantId,
    email,
    password,
    totpCode: generateTotpCode(syntheticTotpSecret, now, 8, 30),
});

process.stdout.write(result.accessToken);

function generateTotpCode(secret, currentTime, digits, periodSeconds) {
    const counter = Math.floor(currentTime.getTime() / 1000 / periodSeconds);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac("sha1", Buffer.from(base32.parse(secret)))
        .update(counterBuffer)
        .digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binaryCode =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return String(binaryCode % 10 ** digits).padStart(digits, "0");
}
