import { randomUUID } from "node:crypto";
import { type Server } from "node:http";

import type { Express } from "express";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";

import { signAccessToken } from "../auth/shared/accessTokenSigner.js";
import { loadAuthJwtConfig } from "../config/authJwtConfig.js";
import { ConflictError, NotFoundError } from "../errors/problem-json.js";
import type { RoleName } from "../db/schema/index.js";
import { syntheticRsaPrivateKeyBase64 } from "../testSupport/jwtTestKeys.js";
import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";
import {
    readGlMappingReference,
    saveGlMappings,
} from "./glMappingRepository.js";

vi.mock("./glMappingRepository.js", () => ({
    readGlMappingReference: vi.fn(),
    saveGlMappings: vi.fn(),
}));

const readGlMappingReferenceMock = vi.mocked(readGlMappingReference);
const saveGlMappingsMock = vi.mocked(saveGlMappings);
const tenantId = "00000000-0000-4000-8000-00000000a701";
const userId = "00000000-0000-4000-8000-00000000a702";
const mappingId = "00000000-0000-4000-8000-00000000a703";
const glCodeId = "00000000-0000-4000-8000-00000000a704";

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

void describe("GL Mapping routes", () => {
    beforeAll(async () => {
        process.env.DATABASE_URL = getCoreCaseTestDatabaseUrl();
        process.env.AUTH_JWT_PRIVATE_KEY_BASE64 = syntheticRsaPrivateKeyBase64;
        process.env.AUTH_JWT_KEY_ID = "synthetic-key-v1";
        process.env.CORE_CASE_RATE_LIMIT_REQUESTS = "100";
        process.env.MFA_TOTP_SECRET_ENCRYPTION_KEY = Buffer.alloc(
            32,
            1,
        ).toString("base64");
        process.env.MFA_TOTP_SECRET_KEY_VERSION = "synthetic-v1";
        app = (await import("../app.js")).app;
    });

    beforeEach(() => {
        readGlMappingReferenceMock.mockReset();
        saveGlMappingsMock.mockReset();
        readGlMappingReferenceMock.mockResolvedValue({
            mappings: [
                {
                    id: mappingId,
                    category: "Travel",
                    glCodeId,
                    accountCode: "6100",
                    accountName: "Travel Expense",
                    description: "Synthetic travel account",
                    updatedAt: "2026-08-03T12:00:00.000Z",
                },
            ],
            glCodes: [
                {
                    id: glCodeId,
                    accountCode: "6100",
                    accountName: "Travel Expense",
                    description: "Synthetic travel account",
                },
            ],
        });
        saveGlMappingsMock.mockResolvedValue({
            mappings: [
                {
                    id: mappingId,
                    category: "Travel",
                    glCodeId,
                    accountCode: "6100",
                    accountName: "Travel Expense",
                    description: "Synthetic travel account",
                    updatedAt: "2026-08-03T12:00:00.000Z",
                },
            ],
            glCodes: [
                {
                    id: glCodeId,
                    accountCode: "6100",
                    accountName: "Travel Expense",
                    description: "Synthetic travel account",
                },
            ],
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test("rejects unauthenticated GL Mapping requests", async () => {
        const response = await requestApp("/v1/gl-mappings");

        expect(response.status).toBe(401);
        expect(readGlMappingReferenceMock).not.toHaveBeenCalled();
    });

    test.each<RoleName>(["Admin"])(
        "rejects %s access to GL Mapping reference data",
        async (role) => {
            const response = await requestApp("/v1/gl-mappings", {
                headers: { authorization: authorizationHeader([role]) },
            });

            expect(response.status).toBe(403);
            expect(readGlMappingReferenceMock).not.toHaveBeenCalled();
        },
    );

    test("allows Employees to read GL Mapping reference data for expense category selection", async () => {
        const response = await requestApp("/v1/gl-mappings", {
            headers: { authorization: authorizationHeader(["Employee"]) },
        });
        const body = (await response.json()) as { mappings: unknown[] };

        expect(response.status).toBe(200);
        expect(body.mappings).toHaveLength(1);
        expect(readGlMappingReferenceMock).toHaveBeenCalledWith(tenantId);
    });

    test("allows Department Managers to read GL Mapping reference data", async () => {
        const response = await requestApp("/v1/gl-mappings", {
            headers: {
                authorization: authorizationHeader(["Department Manager"]),
            },
        });
        const body = (await response.json()) as { mappings: unknown[] };

        expect(response.status).toBe(200);
        expect(response.headers.get("ratelimit-limit")).toBe("100");
        expect(body.mappings).toHaveLength(1);
        expect(readGlMappingReferenceMock).toHaveBeenCalledWith(tenantId);
    });

    test("rejects Department Manager GL Mapping saves", async () => {
        const response = await requestApp("/v1/gl-mappings", {
            method: "PUT",
            headers: {
                authorization: authorizationHeader(["Department Manager"]),
                "content-type": "application/json",
            },
            body: JSON.stringify({ creates: [], updates: [], deletes: [] }),
        });

        expect(response.status).toBe(403);
        expect(saveGlMappingsMock).not.toHaveBeenCalled();
    });

    test("allows Finance Admins to save GL Mapping changes", async () => {
        const response = await requestApp("/v1/gl-mappings", {
            method: "PUT",
            headers: {
                authorization: authorizationHeader(["Finance Admin"]),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                creates: [],
                updates: [
                    {
                        id: mappingId,
                        category: "Travel",
                        accountCode: "6100",
                        description: "Synthetic travel account",
                    },
                ],
                deletes: [],
            }),
        });
        const body = (await response.json()) as { mappings: unknown[] };

        expect(response.status).toBe(200);
        expect(body.mappings).toHaveLength(1);
        expect(saveGlMappingsMock).toHaveBeenCalledWith({
            actorId: userId,
            tenantId,
            creates: [],
            updates: [
                {
                    id: mappingId,
                    category: "Travel",
                    accountCode: "6100",
                    description: "Synthetic travel account",
                },
            ],
            deletes: [],
        });
    });

    test("rejects malformed GL Mapping save bodies", async () => {
        const response = await requestApp("/v1/gl-mappings", {
            method: "PUT",
            headers: {
                authorization: authorizationHeader(["Finance Admin"]),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                creates: [],
                updates: [],
                deletes: [],
                tenantId: randomUUID(),
            }),
        });

        expect(response.status).toBe(400);
        expect(saveGlMappingsMock).not.toHaveBeenCalled();
    });

    test("rejects non-numeric GL account codes in a save", async () => {
        const response = await requestApp("/v1/gl-mappings", {
            method: "PUT",
            headers: {
                authorization: authorizationHeader(["Finance Admin"]),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                creates: [
                    {
                        clientId: "draft-1",
                        category: "Parking",
                        accountCode: "not-a-number",
                        description: null,
                    },
                ],
                updates: [],
                deletes: [],
            }),
        });

        expect(response.status).toBe(400);
        expect(saveGlMappingsMock).not.toHaveBeenCalled();
    });

    test("returns 404 when a Finance Admin save targets another tenant's reference IDs", async () => {
        saveGlMappingsMock.mockRejectedValueOnce(
            new NotFoundError("GL Mapping was not found."),
        );

        const response = await requestApp("/v1/gl-mappings", {
            method: "PUT",
            headers: {
                authorization: authorizationHeader(["Finance Admin"]),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                creates: [],
                updates: [
                    {
                        id: mappingId,
                        category: "Travel",
                        accountCode: "6100",
                        description: null,
                    },
                ],
                deletes: [],
            }),
        });

        expect(response.status).toBe(404);
        expect(saveGlMappingsMock).toHaveBeenCalledWith({
            actorId: userId,
            tenantId,
            creates: [],
            updates: [
                {
                    id: mappingId,
                    category: "Travel",
                    accountCode: "6100",
                    description: null,
                },
            ],
            deletes: [],
        });
    });

    test("returns 409 when a Finance Admin save would duplicate a category", async () => {
        saveGlMappingsMock.mockRejectedValueOnce(
            new ConflictError(
                'GL Mapping category "Travel" is used more than once.',
            ),
        );

        const response = await requestApp("/v1/gl-mappings", {
            method: "PUT",
            headers: {
                authorization: authorizationHeader(["Finance Admin"]),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                creates: [
                    {
                        clientId: "draft-1",
                        category: "Travel",
                        accountCode: "6999",
                        description: null,
                    },
                ],
                updates: [],
                deletes: [],
            }),
        });

        expect(response.status).toBe(409);
    });
});
