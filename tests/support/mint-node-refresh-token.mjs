import { createPrivateKey, randomUUID } from "node:crypto";

import { signRefreshToken } from "../../backend/core-case-service/dist/auth/shared/refreshTokenSigner.js";

const [
    ,
    ,
    privateKeyBase64,
    keyId,
    issuer,
    issuedAtOffsetSeconds,
    refreshTokenTtlSeconds,
] = process.argv;

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const now = new Date(Date.now() + Number(issuedAtOffsetSeconds) * 1000);
const expiresAt = new Date(
    now.getTime() + Number(refreshTokenTtlSeconds) * 1000,
);

const { refreshToken } = signRefreshToken(
    {
        tenantId,
        userId,
        roles: ["Employee"],
        jwtId: randomUUID(),
    },
    {
        issuer,
        privateKey: createPrivateKey(
            Buffer.from(privateKeyBase64, "base64").toString("utf8"),
        ),
        ...(keyId === "__none__" ? {} : { keyId }),
    },
    now,
    expiresAt,
);

process.stdout.write(refreshToken);
