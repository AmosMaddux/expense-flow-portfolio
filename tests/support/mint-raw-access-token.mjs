import { createPrivateKey, createSign } from "node:crypto";

const [, , privateKeyBase64, keyId, payloadJson] = process.argv;

const header = {
    alg: "RS256",
    typ: "JWT",
    ...(keyId === "__none__" ? {} : { kid: keyId }),
};
const payload = JSON.parse(payloadJson);

const privateKey = createPrivateKey(
    Buffer.from(privateKeyBase64, "base64").toString("utf8"),
);

const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .end()
    .sign(privateKey)
    .toString("base64url");

process.stdout.write(`${signingInput}.${signature}`);

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
