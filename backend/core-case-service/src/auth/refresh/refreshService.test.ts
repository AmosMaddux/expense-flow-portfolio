import { createPrivateKey, createPublicKey } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import type { AccessTokenSigningConfig } from "../../config/authJwtConfig.js";
import { UnauthorizedError } from "../../errors/problem-json.js";
import { syntheticRsaPrivateKeyBase64 } from "../../testSupport/jwtTestKeys.js";
import { signRefreshToken } from "../shared/refreshTokenSigner.js";
import type { RefreshTokenVerifierConfig } from "../shared/refreshTokenVerifier.js";
import {
    createRefreshService,
    type ActiveUserRoles,
    type RefreshTokenRepository,
    type StoredRefreshToken,
} from "./refreshService.js";

const tenantId = "00000000-0000-4000-8000-000000000901";
const userId = "10000000-0000-4000-8000-000000000901";
const storedTokenId = "20000000-0000-4000-8000-000000000901";
const issuedAt = new Date("2026-08-03T12:00:00.000Z");

const syntheticPrivateKeyPem = Buffer.from(
    syntheticRsaPrivateKeyBase64,
    "base64",
).toString("utf8");
const testAuthJwtConfig: AccessTokenSigningConfig = {
    issuer: "expenseflow-core-case-service-test",
    audience: "expenseflow-http-api",
    privateKey: createPrivateKey(syntheticPrivateKeyPem),
    keyId: "synthetic-key-v1",
    accessTokenTtlSeconds: 900,
};
const publicKeysById = new Map([
    ["synthetic-key-v1", createPublicKey(syntheticPrivateKeyPem)],
]);
const verifierConfig: RefreshTokenVerifierConfig = {
    issuer: testAuthJwtConfig.issuer,
    publicKeysById,
};

function issueRawRefreshToken(overrides?: {
    expiresAt?: Date;
    tenantId?: string;
    userId?: string;
}): string {
    return signRefreshToken(
        {
            tenantId: overrides?.tenantId ?? tenantId,
            userId: overrides?.userId ?? userId,
            roles: ["Employee"],
            jwtId: "synthetic-jwt-id",
        },
        testAuthJwtConfig,
        issuedAt,
        overrides?.expiresAt ??
            new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    ).refreshToken;
}

function createRepository(
    stored: StoredRefreshToken | undefined,
    activeUser: ActiveUserRoles | undefined,
): RefreshTokenRepository & {
    revokeRefreshTokenMock: ReturnType<typeof vi.fn>;
    rotateRefreshTokenMock: ReturnType<typeof vi.fn>;
} {
    const revokeRefreshTokenMock = vi.fn(() => Promise.resolve());
    const rotateRefreshTokenMock = vi.fn(() => Promise.resolve(true));

    return {
        findRefreshTokenByHash: vi.fn(() => Promise.resolve(stored)),
        findActiveUserRoles: vi.fn(() => Promise.resolve(activeUser)),
        revokeRefreshToken: revokeRefreshTokenMock,
        revokeRefreshTokenMock,
        rotateRefreshToken: rotateRefreshTokenMock,
        rotateRefreshTokenMock,
    };
}

describe("refresh service", () => {
    test("rotates a valid refresh token into a fresh access token", async () => {
        const rawRefreshToken = issueRawRefreshToken();
        const stored: StoredRefreshToken = {
            id: storedTokenId,
            tenantId,
            userId,
            expiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
        };
        const repository = createRepository(stored, {
            status: "active",
            roles: ["Department Manager"],
        });
        const now = () => new Date("2026-08-04T12:00:00.000Z");
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
            now,
        );

        const outcome = await service.refresh(rawRefreshToken);

        expect(outcome.result.tenantId).toBe(tenantId);
        expect(outcome.result.userId).toBe(userId);
        expect(outcome.result.accessToken).not.toBe("");
        const rotateCall = repository.rotateRefreshTokenMock.mock
            .calls[0]?.[0] as
            | {
                  previousTokenId: string;
                  token: { tenantId: string; userId: string };
              }
            | undefined;
        expect(rotateCall?.previousTokenId).toBe(storedTokenId);
        expect(rotateCall?.token.tenantId).toBe(tenantId);
        expect(rotateCall?.token.userId).toBe(userId);
    });

    test("rejects when no refresh token cookie is present", async () => {
        const repository = createRepository(undefined, undefined);
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
        );

        await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        expect(repository.rotateRefreshTokenMock).not.toHaveBeenCalled();
    });

    test("rejects a refresh token with an invalid signature", async () => {
        const tamperedToken = `${issueRawRefreshToken().slice(0, -4)}abcd`;
        const repository = createRepository(undefined, undefined);
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
        );

        await expect(service.refresh(tamperedToken)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
    });

    test("rejects a refresh token that is not recorded in the database", async () => {
        const rawRefreshToken = issueRawRefreshToken();
        const repository = createRepository(undefined, {
            status: "active",
            roles: ["Employee"],
        });
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
        );

        await expect(service.refresh(rawRefreshToken)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        expect(repository.rotateRefreshTokenMock).not.toHaveBeenCalled();
    });

    test("rejects an already-revoked refresh token", async () => {
        const rawRefreshToken = issueRawRefreshToken();
        const stored: StoredRefreshToken = {
            id: storedTokenId,
            tenantId,
            userId,
            expiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: new Date("2026-08-03T13:00:00.000Z"),
        };
        const repository = createRepository(stored, {
            status: "active",
            roles: ["Employee"],
        });
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
        );

        await expect(service.refresh(rawRefreshToken)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        expect(repository.rotateRefreshTokenMock).not.toHaveBeenCalled();
    });

    test("revokes the token and rejects when the user is no longer active", async () => {
        const rawRefreshToken = issueRawRefreshToken();
        const stored: StoredRefreshToken = {
            id: storedTokenId,
            tenantId,
            userId,
            expiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
        };
        const repository = createRepository(stored, {
            status: "deactivated",
            roles: ["Employee"],
        });
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
        );

        await expect(service.refresh(rawRefreshToken)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        expect(repository.revokeRefreshTokenMock).toHaveBeenCalledWith(
            storedTokenId,
        );
        expect(repository.rotateRefreshTokenMock).not.toHaveBeenCalled();
    });

    test("rejects when the stored token's tenant no longer matches the JWT claims", async () => {
        const rawRefreshToken = issueRawRefreshToken();
        const stored: StoredRefreshToken = {
            id: storedTokenId,
            tenantId: "00000000-0000-4000-8000-000000000999",
            userId,
            expiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
        };
        const repository = createRepository(stored, {
            status: "active",
            roles: ["Employee"],
        });
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
        );

        await expect(service.refresh(rawRefreshToken)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
    });

    test("rejects an expired refresh token", async () => {
        const rawRefreshToken = issueRawRefreshToken({
            expiresAt: new Date("2026-08-03T12:30:00.000Z"),
        });
        const repository = createRepository(undefined, undefined);
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
            () => new Date("2026-08-04T12:00:00.000Z"),
        );

        await expect(service.refresh(rawRefreshToken)).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
    });

    test("returns updated roles picked up since the token was issued", async () => {
        const rawRefreshToken = issueRawRefreshToken();
        const stored: StoredRefreshToken = {
            id: storedTokenId,
            tenantId,
            userId,
            expiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
        };
        const repository = createRepository(stored, {
            status: "active",
            roles: ["Finance Admin"],
        });
        const now = () => new Date("2026-08-04T12:00:00.000Z");
        const service = createRefreshService(
            repository,
            verifierConfig,
            testAuthJwtConfig,
            now,
        );

        const outcome = await service.refresh(rawRefreshToken);
        const payload = JSON.parse(
            Buffer.from(
                outcome.result.accessToken.split(".")[1] ?? "",
                "base64url",
            ).toString("utf8"),
        ) as { roles: string[] };

        expect(payload.roles).toEqual(["Finance Admin"]);
    });
});
