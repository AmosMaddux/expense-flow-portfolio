import { describe, expect, test, vi } from "vitest";

import { ForbiddenError } from "../errors/problem-json.js";
import { getGlMappings, putGlMappings } from "./glMappingController.js";
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

const emptySaveBody = { creates: [], updates: [], deletes: [] };

describe("GL Mapping controller", () => {
    test("allows Department Managers to read tenant-scoped mappings", async () => {
        readGlMappingReferenceMock.mockResolvedValueOnce({
            mappings: [],
            glCodes: [],
        });
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Department Manager"],
            },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        await getGlMappings(req as never, res as never, next);

        expect(readGlMappingReferenceMock).toHaveBeenCalledWith(
            "00000000-0000-4000-8000-000000000701",
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ mappings: [], glCodes: [] });
        expect(next).not.toHaveBeenCalled();
    });

    test("allows Employees to read tenant-scoped mappings for expense category selection", async () => {
        readGlMappingReferenceMock.mockResolvedValueOnce({
            mappings: [],
            glCodes: [],
        });
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Employee"],
            },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        await getGlMappings(req as never, res as never, next);

        expect(readGlMappingReferenceMock).toHaveBeenCalledWith(
            "00000000-0000-4000-8000-000000000701",
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });

    test("rejects Department Managers before saving GL mapping changes", async () => {
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Department Manager"],
            },
            params: {},
            body: emptySaveBody,
        };
        const res = createResponse();
        const next = vi.fn();

        await putGlMappings(req as never, res as never, next);

        expect(saveGlMappingsMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("rejects unknown Finance Admin save fields before repository writes", async () => {
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Finance Admin"],
            },
            params: {},
            body: {
                ...emptySaveBody,
                tenantId: "00000000-0000-4000-8000-000000000999",
            },
        };
        const res = createResponse();
        const next = vi.fn();

        await putGlMappings(req as never, res as never, next);

        expect(saveGlMappingsMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test("rejects non-numeric account codes before repository writes", async () => {
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Finance Admin"],
            },
            params: {},
            body: {
                creates: [
                    {
                        clientId: "draft-1",
                        category: "Parking",
                        accountCode: "abc",
                        description: null,
                    },
                ],
                updates: [],
                deletes: [],
            },
        };
        const res = createResponse();
        const next = vi.fn();

        await putGlMappings(req as never, res as never, next);

        expect(saveGlMappingsMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test("allows Finance Admins to save GL mapping creates, updates, and deletes", async () => {
        saveGlMappingsMock.mockResolvedValueOnce({
            mappings: [
                {
                    id: "00000000-0000-4000-8000-000000000703",
                    category: "Travel",
                    glCodeId: "00000000-0000-4000-8000-000000000704",
                    accountCode: "6100",
                    accountName: "Travel",
                    description: "Synthetic travel account",
                    updatedAt: "2026-08-03T12:00:00.000Z",
                },
            ],
            glCodes: [],
        });
        const body = {
            creates: [
                {
                    clientId: "draft-1",
                    category: "Parking",
                    accountCode: "6700",
                    description: null,
                },
            ],
            updates: [
                {
                    id: "00000000-0000-4000-8000-000000000703",
                    category: "Travel",
                    accountCode: "6100",
                    description: "Synthetic travel account",
                },
            ],
            deletes: ["00000000-0000-4000-8000-000000000710"],
        };
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Finance Admin"],
            },
            params: {},
            body,
        };
        const res = createResponse();
        const next = vi.fn();

        await putGlMappings(req as never, res as never, next);

        expect(saveGlMappingsMock).toHaveBeenCalledWith({
            actorId: "00000000-0000-4000-8000-000000000702",
            tenantId: "00000000-0000-4000-8000-000000000701",
            ...body,
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });
});

function createResponse() {
    const response = {
        status: vi.fn(() => response),
        json: vi.fn(() => response),
    };

    return response;
}
