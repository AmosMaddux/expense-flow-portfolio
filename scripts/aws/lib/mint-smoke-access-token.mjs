#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const awsProfile = process.env.AWS_PROFILE ?? "expenseflow-smoke";
const awsRegion = process.env.AWS_REGION ?? "us-east-1";
const privateKeySecretId = requireArg(args, "private-key-secret-id");
const issuer = requireArg(args, "issuer").replace(/\/+$/, "");
const keyId = requireArg(args, "key-id");
const audience = args.audience ?? "expenseflow-http-api";
const tenantId = args["tenant-id"] ?? "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = args["user-id"] ?? "9f1b3f5c-1dc8-4f37-8a23-000000000003";
const role = args.role ?? "Finance Admin";
const validTtlSeconds = Number(args["valid-ttl-seconds"] ?? "900");
const expiredAgeSeconds = Number(args["expired-age-seconds"] ?? "300");

if (!Number.isInteger(validTtlSeconds) || validTtlSeconds <= 0) {
    throw new Error("valid-ttl-seconds must be a positive integer.");
}
if (!Number.isInteger(expiredAgeSeconds) || expiredAgeSeconds <= 0) {
    throw new Error("expired-age-seconds must be a positive integer.");
}

const privateKeyBase64 = await readSecret(privateKeySecretId);
const privateKey = createPrivateKey(
    Buffer.from(privateKeyBase64, "base64").toString("utf8"),
);
const nowSeconds = Math.floor(Date.now() / 1000);
const validAccessToken = signToken({
    privateKey,
    keyId,
    payload: accessTokenPayload({
        audience,
        expiresAtSeconds: nowSeconds + validTtlSeconds,
        issuedAtSeconds: nowSeconds,
        issuer,
        role,
        tenantId,
        userId,
    }),
});
const expiredAccessToken = signToken({
    privateKey,
    keyId,
    payload: accessTokenPayload({
        audience,
        expiresAtSeconds: nowSeconds - expiredAgeSeconds,
        issuedAtSeconds: nowSeconds - expiredAgeSeconds - validTtlSeconds,
        issuer,
        role,
        tenantId,
        userId,
    }),
});

process.stdout.write(
    [
        `VALID_ACCESS_TOKEN=${validAccessToken}`,
        `EXPIRED_ACCESS_TOKEN=${expiredAccessToken}`,
        "",
    ].join("\n"),
);

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const current = values[index];
        if (!current?.startsWith("--")) {
            throw new Error(`Unexpected argument: ${current}`);
        }

        const key = current.slice(2);
        const next = values[index + 1];
        if (next === undefined || next.startsWith("--")) {
            throw new Error(`Missing value for --${key}.`);
        }
        parsed[key] = next;
        index += 1;
    }

    return parsed;
}

function requireArg(argsByName, name) {
    const value = argsByName[name];
    if (value === undefined || value.trim() === "") {
        throw new Error(`--${name} is required.`);
    }

    return value;
}

async function readSecret(secretId) {
    const { stdout } = await execFileAsync(
        "aws",
        [
            "--profile",
            awsProfile,
            "--region",
            awsRegion,
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            secretId,
            "--query",
            "SecretString",
            "--output",
            "text",
        ],
        {
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
        },
    );

    const secret = stdout.trim();
    if (secret === "") {
        throw new Error("JWT private key secret is empty.");
    }

    return secret;
}

function accessTokenPayload(input) {
    return {
        iss: input.issuer,
        aud: input.audience,
        sub: input.userId,
        tenant_id: input.tenantId,
        roles: [input.role],
        token_use: "access",
        iat: input.issuedAtSeconds,
        exp: input.expiresAtSeconds,
        jti: randomUUID(),
    };
}

function signToken(input) {
    const header = {
        alg: "RS256",
        typ: "JWT",
        kid: input.keyId,
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(input.payload)}`;
    const signature = createSign("RSA-SHA256")
        .update(signingInput)
        .end()
        .sign(input.privateKey)
        .toString("base64url");

    return `${signingInput}.${signature}`;
}

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
