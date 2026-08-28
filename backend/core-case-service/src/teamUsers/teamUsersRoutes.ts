import { Router } from "express";

import {
    getTeamUsers,
    patchTeamUserRole,
    patchTeamUserStatus,
    postInviteTeamUser,
} from "./teamUsersController.js";

export const teamUsersRouter = Router();

teamUsersRouter.get("/users", getTeamUsers);
teamUsersRouter.post("/users/invite", postInviteTeamUser);
teamUsersRouter.patch("/users/:id/role", patchTeamUserRole);
teamUsersRouter.patch("/users/:id/status", patchTeamUserStatus);
