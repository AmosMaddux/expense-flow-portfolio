import { afterEach, describe, expect, test, vi } from "vitest";

import { ConflictError, ForbiddenError } from "../errors/problem-json.js";
import {
    getTeamUsers,
    patchTeamUserRole,
    patchTeamUserStatus,
    postInviteTeamUser,
} from "./teamUsersController.js";
import {
    inviteTeamUser,
    readTeamUsers,
    updateTeamUserRole,
    updateTeamUserStatus,
} from "./teamUsersRepository.js";

vi.mock("./teamUsersRepository.js", () => ({
    inviteTeamUser: vi.fn(),
    readTeamUsers: vi.fn(),
    updateTeamUserRole: vi.fn(),
    updateTeamUserStatus: vi.fn(),
}));

const readTeamUsersMock = vi.mocked(readTeamUsers);
const inviteTeamUserMock = vi.mocked(inviteTeamUser);
const updateTeamUserRoleMock = vi.mocked(updateTeamUserRole);
const updateTeamUserStatusMock = vi.mocked(updateTeamUserStatus);

const tenantId = "00000000-0000-4000-8000-000000000701";
const managerUserId = "00000000-0000-4000-8000-000000000702";
const financeAdminUserId = "00000000-0000-4000-8000-000000000703";
const teamMemberId = "00000000-0000-4000-8000-000000000704";

describe("Team Users controller", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    test("lets Finance Admins read every tenant user", async () => {
        readTeamUsersMock.mockResolvedValueOnce([]);
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

        await getTeamUsers(req as never, res as never, next);

        expect(readTeamUsersMock).toHaveBeenCalledWith(tenantId);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ users: [] });
        expect(next).not.toHaveBeenCalled();
    });

    test("rejects Department Manager reads before touching the repository", async () => {
        const req = {
            auth: {
                tenantId,
                userId: managerUserId,
                roles: ["Department Manager"],
            },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        await getTeamUsers(req as never, res as never, next);

        expect(readTeamUsersMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("rejects Employee reads before touching the repository", async () => {
        const req = {
            auth: { tenantId, userId: teamMemberId, roles: ["Employee"] },
            params: {},
            body: {},
        };
        const res = createResponse();
        const next = vi.fn();

        await getTeamUsers(req as never, res as never, next);

        expect(readTeamUsersMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("rejects Department Managers before inviting a user", async () => {
        const req = {
            auth: {
                tenantId,
                userId: managerUserId,
                roles: ["Department Manager"],
            },
            params: {},
            body: {
                email: "new-hire@example1.invalid",
                displayName: "New Hire",
                role: "Employee",
            },
        };
        const res = createResponse();
        const next = vi.fn();

        await postInviteTeamUser(req as never, res as never, next);

        expect(inviteTeamUserMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("lets Finance Admins invite a user with an assigned role", async () => {
        inviteTeamUserMock.mockResolvedValueOnce({
            id: teamMemberId,
            email: "new-hire@example1.invalid",
            displayName: "New Hire",
            status: "invited",
            roles: ["Employee"],
            createdAt: "2026-08-03T12:00:00.000Z",
        });
        const req = {
            auth: {
                tenantId,
                userId: financeAdminUserId,
                roles: ["Finance Admin"],
            },
            params: {},
            body: {
                email: "new-hire@example1.invalid",
                displayName: "New Hire",
                role: "Employee",
            },
        };
        const res = createResponse();
        const next = vi.fn();

        await postInviteTeamUser(req as never, res as never, next);

        expect(inviteTeamUserMock).toHaveBeenCalledWith({
            actorId: financeAdminUserId,
            displayName: "New Hire",
            email: "new-hire@example1.invalid",
            role: "Employee",
            tenantId,
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(next).not.toHaveBeenCalled();
    });

    test("rejects Department Managers before changing a role", async () => {
        const req = {
            auth: {
                tenantId,
                userId: managerUserId,
                roles: ["Department Manager"],
            },
            params: { id: teamMemberId },
            body: { role: "Finance Admin" },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchTeamUserRole(req as never, res as never, next);

        expect(updateTeamUserRoleMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("rejects Department Managers before changing a status", async () => {
        const req = {
            auth: {
                tenantId,
                userId: managerUserId,
                roles: ["Department Manager"],
            },
            params: { id: teamMemberId },
            body: { status: "deactivated" },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchTeamUserStatus(req as never, res as never, next);

        expect(updateTeamUserStatusMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test("rejects a Finance Admin changing their own role", async () => {
        const req = {
            auth: {
                tenantId,
                userId: financeAdminUserId,
                roles: ["Finance Admin"],
            },
            params: { id: financeAdminUserId },
            body: { role: "Employee" },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchTeamUserRole(req as never, res as never, next);

        expect(updateTeamUserRoleMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
    });

    test("rejects a Finance Admin deactivating their own account", async () => {
        const req = {
            auth: {
                tenantId,
                userId: financeAdminUserId,
                roles: ["Finance Admin"],
            },
            params: { id: financeAdminUserId },
            body: { status: "deactivated" },
        };
        const res = createResponse();
        const next = vi.fn();

        await patchTeamUserStatus(req as never, res as never, next);

        expect(updateTeamUserStatusMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
    });
});

function createResponse() {
    const response = {
        status: vi.fn(() => response),
        json: vi.fn(() => response),
    };

    return response;
}
