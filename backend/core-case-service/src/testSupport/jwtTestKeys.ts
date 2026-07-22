import { generateKeyPairSync } from "node:crypto";

const syntheticRsaKeyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
});

export const syntheticRsaPrivateKeyBase64 = Buffer.from(
    syntheticRsaKeyPair.privateKey.export({
        type: "pkcs8",
        format: "pem",
    }),
).toString("base64");

export const syntheticRsaPublicKeyBase64 = Buffer.from(
    syntheticRsaKeyPair.publicKey.export({
        type: "spki",
        format: "pem",
    }),
).toString("base64");
