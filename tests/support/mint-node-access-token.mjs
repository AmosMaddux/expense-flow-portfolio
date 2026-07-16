import { createPrivateKey } from "node:crypto";

import { signAccessToken } from "../../backend/core-case-service/dist/auth/shared/accessTokenSigner.js";

const [
    ,
    ,
    privateKeyBase64,
    issuer,
    issuedAtOffsetSeconds,
    accessTokenTtlSeconds,
] = process.argv;

const privateKey = createPrivateKey(
    Buffer.from(privateKeyBase64, "base64").toString("utf8"),
);
const issuedAt = new Date(Date.now() + Number(issuedAtOffsetSeconds) * 1000);

const issuedToken = signAccessToken(
    {
        tenantId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        roles: ["Employee"],
    },
    {
        issuer,
        privateKey,
        keyId: "synthetic-runtime-key",
        accessTokenTtlSeconds: Number(accessTokenTtlSeconds),
    },
    issuedAt,
);

process.stdout.write(issuedToken.accessToken);
