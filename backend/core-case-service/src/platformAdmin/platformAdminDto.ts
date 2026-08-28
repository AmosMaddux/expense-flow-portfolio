import { z } from "zod";

import { roleValues } from "../db/schema/identityAuth.js";

export const RolePermissionMatrixScreenSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
});

export const RolePermissionMatrixRoleSchema = z.object({
    role: z.enum(roleValues),
    screens: z.record(z.string(), z.boolean()),
});

export const RolePermissionMatrixOutboundResponseSchema = z.object({
    screens: z.array(RolePermissionMatrixScreenSchema),
    roles: z.array(RolePermissionMatrixRoleSchema),
});

export const TenantSummaryOutboundResponseSchema = z.object({
    tenantId: z.uuid(),
    userCount: z.number().int().nonnegative(),
    activeUserCount: z.number().int().nonnegative(),
    invitedUserCount: z.number().int().nonnegative(),
    deactivatedUserCount: z.number().int().nonnegative(),
});

export const TenantSummaryListOutboundResponseSchema = z.object({
    tenants: z.array(TenantSummaryOutboundResponseSchema),
});

export type RolePermissionMatrixResponse = z.infer<
    typeof RolePermissionMatrixOutboundResponseSchema
>;
export type TenantSummary = z.infer<typeof TenantSummaryOutboundResponseSchema>;
export type TenantSummaryListResponse = z.infer<
    typeof TenantSummaryListOutboundResponseSchema
>;
