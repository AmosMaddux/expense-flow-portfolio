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

// Mirrors the reference_data_audit_entry_entity_type_check constraint.
export const AuditLogEntityTypeSchema = z.enum(["gl_mapping", "user"]);

// Mirrors the reference_data_audit_entry_action_check constraint.
export const AuditLogActionSchema = z.enum([
    "gl_mapping_updated",
    "user_invited",
    "user_role_changed",
    "user_status_changed",
]);

export const AuditLogActorSchema = z.object({
    id: z.uuid(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
});

export const AuditLogEntryOutboundResponseSchema = z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    actor: AuditLogActorSchema,
    entityType: AuditLogEntityTypeSchema,
    entityId: z.uuid(),
    action: AuditLogActionSchema,
    occurredAt: z.iso.datetime({ offset: true }),
});

export const AuditLogEntryPageOutboundResponseSchema = z.object({
    events: z.array(AuditLogEntryOutboundResponseSchema),
    nextCursor: z.string().nullable(),
});

// The opaque cursor decodes to this shape: the last returned event's
// (createdAt, id) tuple, matching the repository's keyset ORDER BY.
export const AuditLogCursorSchema = z
    .object({
        createdAt: z.iso.datetime({ offset: true }),
        id: z.uuid(),
    })
    .strict();

export const ReadAuditLogEventsQuerySchema = z
    .object({
        cursor: z
            .string()
            .trim()
            .min(1)
            .max(512)
            .regex(/^[A-Za-z0-9_-]+$/)
            .optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
    })
    .strict();

export type RolePermissionMatrixResponse = z.infer<
    typeof RolePermissionMatrixOutboundResponseSchema
>;
export type TenantSummary = z.infer<typeof TenantSummaryOutboundResponseSchema>;
export type TenantSummaryListResponse = z.infer<
    typeof TenantSummaryListOutboundResponseSchema
>;
export type AuditLogEntry = z.infer<typeof AuditLogEntryOutboundResponseSchema>;
export type AuditLogEntryPageResponse = z.infer<
    typeof AuditLogEntryPageOutboundResponseSchema
>;
export type ReadAuditLogEventsQuery = z.infer<
    typeof ReadAuditLogEventsQuerySchema
>;
