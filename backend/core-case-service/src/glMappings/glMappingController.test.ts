import { describe, expect, test, vi } from "vitest";

import { ForbiddenError } from "../errors/problem-json.js";
import { getGlMappings, patchGlMapping } from "./glMappingController.js";
import {
    readGlMappingReference,
    updateGlMapping,
} from "./glMappingRepository.js";

vi.mock("./glMappingRepository.js", () => ({
    readGlMappingReference: vi.fn(),
    updateGlMapping: vi.fn(),
}));

const readGlMappingReferenceMock = vi.mocked(readGlMappingReference);
const updateGlMappingMock = vi.mocked(updateGlMapping);

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

    test("rejects Department Managers before updating GL mappings", async () => {
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Department Manager"],
            },
            params: { id: "00000000-0000-4000-8000-000000000703" },
            body: { glCodeId: "00000000-0000-4000-8000-000000000704" },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchGlMapping(req as never, res as never, next);

        expect(updateGlMappingMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("rejects unknown Finance Admin update fields before repository writes", async () => {
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Finance Admin"],
            },
            params: { id: "00000000-0000-4000-8000-000000000703" },
            body: {
                glCodeId: "00000000-0000-4000-8000-000000000704",
                tenantId: "00000000-0000-4000-8000-000000000999",
            },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchGlMapping(req as never, res as never, next);

        expect(updateGlMappingMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
    test("allows Finance Admins to update GL mappings", async () => {
        updateGlMappingMock.mockResolvedValueOnce({
            id: "00000000-0000-4000-8000-000000000703",
            category: "Travel",
            glCodeId: "00000000-0000-4000-8000-000000000704",
            accountCode: "6100",
            accountName: "Travel Expense",
            description: "Synthetic travel account",
            updatedAt: "2026-08-03T12:00:00.000Z",
        });
        const req = {
            auth: {
                tenantId: "00000000-0000-4000-8000-000000000701",
                userId: "00000000-0000-4000-8000-000000000702",
                roles: ["Finance Admin"],
            },
            params: { id: "00000000-0000-4000-8000-000000000703" },
            body: { glCodeId: "00000000-0000-4000-8000-000000000704" },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchGlMapping(req as never, res as never, next);

        expect(updateGlMappingMock).toHaveBeenCalledWith({
            actorId: "00000000-0000-4000-8000-000000000702",
            glCodeId: "00000000-0000-4000-8000-000000000704",
            id: "00000000-0000-4000-8000-000000000703",
            tenantId: "00000000-0000-4000-8000-000000000701",
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
