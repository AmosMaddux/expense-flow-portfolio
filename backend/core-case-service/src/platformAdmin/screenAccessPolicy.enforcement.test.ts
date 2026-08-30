import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, test, vi } from "vitest";

import { roleValues, type RoleName } from "../db/schema/identityAuth.js";
import { ForbiddenError } from "../errors/problem-json.js";
import {
    getRolePermissionMatrix,
    getTenantSummaries,
} from "./platformAdminController.js";
import { readTenantSummaries } from "./platformAdminRepository.js";
import { screenAccessPolicy } from "./screenAccessPolicy.js";
import { getTeamUsers } from "../teamUsers/teamUsersController.js";
import { readTeamUsers } from "../teamUsers/teamUsersRepository.js";

vi.mock("../teamUsers/teamUsersRepository.js", () => ({
    readTeamUsers: vi.fn(),
}));
vi.mock("./platformAdminRepository.js", () => ({
    readTenantSummaries: vi.fn(),
}));

const readTeamUsersMock = vi.mocked(readTeamUsers);
const readTenantSummariesMock = vi.mocked(readTenantSummaries);

const tenantId = "00000000-0000-4000-8000-000000000901";
const userId = "00000000-0000-4000-8000-000000000902";

/**
 * Maps a screenAccessPolicy entry's key to the real controller enforcing it,
 * so a drift between the declared matrix and actual enforcement fails here
 * instead of shipping silently. Screens without a wired backend route (e.g.
 * "audit-log", not yet implemented) are intentionally not covered.
 */
type ScreenController = (
    req: Request,
    res: Response,
    next: NextFunction,
) => void | Promise<void>;

const enforcedScreenControllers: Record<string, ScreenController> = {
    "team-users": getTeamUsers,
    "roles-permissions": getRolePermissionMatrix,
    "tenants-users": getTenantSummaries,
};

describe("screenAccessPolicy stays in sync with real enforcement", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    test.each(Object.keys(enforcedScreenControllers))(
        "%s: allowedRoles matches the controller's role gate for every role",
        async (screenKey) => {
            const entry = screenAccessPolicy.find(
                (candidate) => candidate.key === screenKey,
            );
            if (entry === undefined) {
                throw new Error(
                    `screenAccessPolicy is missing an entry for "${screenKey}".`,
                );
            }

            const controller = enforcedScreenControllers[screenKey];
            if (controller === undefined) {
                throw new Error(
                    `No controller mapped for screen "${screenKey}".`,
                );
            }
            readTeamUsersMock.mockResolvedValue([]);
            readTenantSummariesMock.mockResolvedValue([]);

            for (const role of roleValues) {
                const next = vi.fn();
                const res = {
                    status: vi.fn(() => res),
                    json: vi.fn(() => res),
                };
                const req = {
                    auth: { tenantId, userId, roles: [role] as RoleName[] },
                    params: {},
                    body: {},
                };

                await controller(req as never, res as never, next);

                const isAllowed = entry.allowedRoles.includes(role);
                if (isAllowed) {
                    expect(
                        next,
                        `expected ${role} to be allowed on "${screenKey}" per screenAccessPolicy, but the controller rejected it`,
                    ).not.toHaveBeenCalled();
                } else {
                    expect(
                        next,
                        `expected ${role} to be rejected on "${screenKey}" per screenAccessPolicy, but the controller allowed it`,
                    ).toHaveBeenCalledWith(expect.any(ForbiddenError));
                }
            }
        },
    );
});
