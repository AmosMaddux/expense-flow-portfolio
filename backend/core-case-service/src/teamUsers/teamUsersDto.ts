import { z } from "zod";

import { roleValues, userStatusValues } from "../db/schema/identityAuth.js";

export const TeamUserOutboundResponseSchema = z.object({
    id: z.uuid(),
    email: z.string().min(1),
    displayName: z.string().nullable(),
    status: z.enum(userStatusValues),
    roles: z.array(z.enum(roleValues)),
    createdAt: z.iso.datetime({ offset: true }),
});

export const TeamUsersListOutboundResponseSchema = z.object({
    users: z.array(TeamUserOutboundResponseSchema),
});

export const InviteTeamUserInboundRequestSchema = z
    .object({
        email: z.email(),
        displayName: z.string().trim().min(1).max(200),
        role: z.enum(roleValues),
    })
    .strict();

export const TeamUserPathParamsSchema = z.object({
    id: z.uuid(),
});

export const UpdateTeamUserRoleInboundRequestSchema = z
    .object({
        role: z.enum(roleValues),
    })
    .strict();

export const UpdateTeamUserStatusInboundRequestSchema = z
    .object({
        status: z.enum(["active", "deactivated"]),
    })
    .strict();

export type TeamUserResponse = z.infer<typeof TeamUserOutboundResponseSchema>;
export type TeamUsersListResponse = z.infer<
    typeof TeamUsersListOutboundResponseSchema
>;
export type InviteTeamUserRequest = z.infer<
    typeof InviteTeamUserInboundRequestSchema
>;
export type UpdateTeamUserRoleRequest = z.infer<
    typeof UpdateTeamUserRoleInboundRequestSchema
>;
export type UpdateTeamUserStatusRequest = z.infer<
    typeof UpdateTeamUserStatusInboundRequestSchema
>;
