import { afterEach, describe, expect, test, vi } from "vitest";

import { ForbiddenError } from "../errors/problem-json.js";
import {
    getRolePermissionMatrix,
    getTenantSummaries,
} from "./platformAdminController.js";
import { readTenantSummaries } from "./platformAdminRepository.js";
import { buildRolePermissionMatrix } from "./screenAccessPolicy.js";

vi.mock("./platformAdminRepository.js", () => ({
    readTenantSummaries: vi.fn(),
}));

const readTenantSummariesMock = vi.mocked(readTenantSummaries);

const tenantId = "00000000-0000-4000-8000-000000000801";
const platformAdminUserId = "00000000-0000-4000-8000-000000000802";
const financeAdminUserId = "00000000-0000-4000-8000-000000000803";

describe("Platform Admin controller", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    test("lets a Platform Admin read the role-to-screen-access matrix", () => {
        const req = {
            auth: { tenantId, userId: platformAdminUserId, roles: ["Admin"] },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        getRolePermissionMatrix(req as never, res as never, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(buildRolePermissionMatrix());
        expect(next).not.toHaveBeenCalled();
    });

    test("rejects a Finance Admin reading the role-to-screen-access matrix", () => {
        const req = {
            auth: {
                tenantId,
                userId: financeAdminUserId,
                roles: ["Finance Admin"],
            },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        getRolePermissionMatrix(req as never, res as never, next);

        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("lets a Platform Admin read tenant summaries across every tenant", async () => {
        readTenantSummariesMock.mockResolvedValueOnce([
            {
                tenantId,
                userCount: 3,
                activeUserCount: 2,
                invitedUserCount: 1,
                deactivatedUserCount: 0,
            },
        ]);
        const req = {
            auth: { tenantId, userId: platformAdminUserId, roles: ["Admin"] },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        await getTenantSummaries(req as never, res as never, next);

        expect(readTenantSummariesMock).toHaveBeenCalledWith();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            tenants: [
                {
                    tenantId,
                    userCount: 3,
                    activeUserCount: 2,
                    invitedUserCount: 1,
                    deactivatedUserCount: 0,
                },
            ],
        });
        expect(next).not.toHaveBeenCalled();
    });

    test("rejects a Finance Admin reading tenant summaries before touching the repository", async () => {
        const req = {
            auth: {
                tenantId,
                userId: financeAdminUserId,
                roles: ["Finance Admin"],
            },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        await getTenantSummaries(req as never, res as never, next);

        expect(readTenantSummariesMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
});

function createResponse() {
    const response = {
        status: vi.fn(() => response),
        json: vi.fn(() => response),
    };

    return response;
}
