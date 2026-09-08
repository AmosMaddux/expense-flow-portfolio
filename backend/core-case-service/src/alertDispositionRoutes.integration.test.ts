import { type Server } from "node:http";

import type { Express } from "express";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { signAccessToken } from "./auth/shared/accessTokenSigner.js";
import { loadAuthJwtConfig } from "./config/authJwtConfig.js";
import type { RoleName } from "./db/schema/index.js";
import { syntheticRsaPrivateKeyBase64 } from "./testSupport/jwtTestKeys.js";
import { getCoreCaseTestDatabaseUrl } from "./testSupport/coreCaseTestDatabase.js";

const alertDispositionModule = vi.hoisted(() => ({
    createAlertDisposition: vi.fn(),
    readAlertDispositions: vi.fn(),
}));

vi.mock("./alertDisposition.js", async () => {
    const actual = await vi.importActual<
        typeof import("./alertDisposition.js")
    >("./alertDisposition.js");

    return {
        ...actual,
        createAlertDisposition: alertDispositionModule.createAlertDisposition,
        readAlertDispositions: alertDispositionModule.readAlertDispositions,
    };
});

const tenantId = "00000000-0000-4000-8000-00000000b701";
const userId = "00000000-0000-4000-8000-00000000b702";

let app: Express;

async function requestApp(path: string, init?: RequestInit): Promise<Response> {
    const server = await listenOnEphemeralPort();
    const address = server.address();

    if (address === null || typeof address === "string") {
        await closeServer(server);
        throw new Error("Expected test server to listen on a TCP port");
    }

    try {
        return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    } finally {
        await closeServer(server);
    }
}

function listenOnEphemeralPort(): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1");
        server.once("listening", () => {
            resolve(server);
        });
        server.once("error", reject);
    });
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolve();
                return;
            }

            reject(error);
        });
    });
}

function authorizationHeader(roles: RoleName[], tenant = tenantId): string {
    const { accessToken } = signAccessToken(
        { tenantId: tenant, userId, roles },
        loadAuthJwtConfig(),
        new Date(),
    );

    return `Bearer ${accessToken}`;
}

describe("alert disposition routes", () => {
    beforeAll(async () => {
        process.env.DATABASE_URL = getCoreCaseTestDatabaseUrl();
        process.env.AUTH_JWT_PRIVATE_KEY_BASE64 = syntheticRsaPrivateKeyBase64;
        process.env.AUTH_JWT_KEY_ID = "synthetic-key-v1";
        process.env.CORE_CASE_INTERNAL_ROUTES_ENABLED = "true";
        process.env.CORE_CASE_RATE_LIMIT_REQUESTS = "100";
        process.env.MFA_TOTP_SECRET_ENCRYPTION_KEY = Buffer.alloc(
            32,
            1,
        ).toString("base64");
        process.env.MFA_TOTP_SECRET_KEY_VERSION = "synthetic-v1";
        app = (await import("./app.js")).app;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test("rejects unauthenticated internal alert disposition requests", async () => {
        const response = await requestApp("/v1/internal/alert-dispositions");

        expect(response.status).toBe(401);
        expect(
            alertDispositionModule.readAlertDispositions,
        ).not.toHaveBeenCalled();
    });

    test.each<RoleName>(["Employee", "Admin"])(
        "rejects %s access to alert dispositions",
        async (role) => {
            const response = await requestApp(
                "/v1/internal/alert-dispositions",
                {
                    headers: { authorization: authorizationHeader([role]) },
                },
            );

            expect(response.status).toBe(403);
            expect(
                alertDispositionModule.readAlertDispositions,
            ).not.toHaveBeenCalled();
        },
    );

    test.each<RoleName>(["Finance Admin", "Department Manager"])(
        "allows %s to read alert dispositions for the authenticated tenant",
        async (role) => {
            alertDispositionModule.readAlertDispositions.mockResolvedValue([]);

            const response = await requestApp(
                "/v1/internal/alert-dispositions?limit=7",
                {
                    headers: { authorization: authorizationHeader([role]) },
                },
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toStrictEqual([]);
            expect(
                alertDispositionModule.readAlertDispositions,
            ).toHaveBeenCalledWith({
                limit: 7,
                tenantId,
            });
        },
    );

    test("does not leak tenant scope through the route query string", async () => {
        alertDispositionModule.readAlertDispositions.mockResolvedValue([]);

        const response = await requestApp(
            "/v1/internal/alert-dispositions?limit=7&tenantId=00000000-0000-4000-8000-00000000ffff",
            {
                headers: {
                    authorization: authorizationHeader(["Finance Admin"]),
                },
            },
        );

        expect(response.status).toBe(200);
        expect(
            alertDispositionModule.readAlertDispositions,
        ).toHaveBeenCalledWith({
            limit: 7,
            tenantId,
        });
    });
});
