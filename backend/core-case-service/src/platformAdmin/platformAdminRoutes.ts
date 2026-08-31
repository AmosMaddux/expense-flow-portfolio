import { Router } from "express";

import {
    getAuditLogEvents,
    getRolePermissionMatrix,
    getTenantSummaries,
} from "./platformAdminController.js";

export const platformAdminRouter = Router();

platformAdminRouter.get(
    "/platform-admin/roles-permissions",
    getRolePermissionMatrix,
);
platformAdminRouter.get("/platform-admin/tenants", getTenantSummaries);
platformAdminRouter.get("/platform-admin/audit-log", getAuditLogEvents);
