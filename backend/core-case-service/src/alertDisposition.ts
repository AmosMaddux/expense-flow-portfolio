import { desc, eq } from "drizzle-orm";
import type { Request } from "express";

import { db } from "./db/client.js";
import {
    alertDisposition,
    type AlertDisposition,
    type NewAlertDisposition,
} from "./db/schema/expenseReport.js";
import { ForbiddenError, NotFoundError } from "./errors/problem-json.js";
import { logCoreCaseInfo } from "./logging/coreCaseLogger.js";
import { AlertDispositionResponseSchema } from "./schemas/alertDisposition.schema.js";

import type {
    AlertDispositionQuery,
    AlertDispositionResponse,
    CreateAlertDispositionInboundRequest,
} from "./schemas/alertDisposition.schema.js";

/**
 * Records one investigated alert and its disposition for a tenant.
 */
export async function createAlertDisposition(
    request: CreateAlertDispositionInboundRequest & {
        tenantId: string;
        investigatedBy: string;
    },
): Promise<AlertDispositionResponse> {
    const inserted = await db
        .insert(alertDisposition)
        .values(toNewAlertDisposition(request))
        .returning();
    const row = inserted[0];
    if (row === undefined) {
        throw new NotFoundError("Alert disposition could not be recorded.");
    }

    const response = toAlertDispositionResponse(row);
    logCoreCaseInfo({
        eventType: "alert_disposition",
        metricName: "AlertDispositionRecordedCount",
        metricValue: 1,
        tenantId: request.tenantId,
        alertId: request.alertId,
        alertName: request.alertName,
        source: request.source,
        severity: request.severity,
        status: request.status,
        correlationId: request.correlationId ?? null,
        traceId: request.traceId ?? null,
        investigatedBy: request.investigatedBy,
        resolvedAt: response.resolvedAt?.toISOString() ?? null,
        createdAt: response.createdAt.toISOString(),
        outcome: "success",
        service: "core-case-service",
    });

    return response;
}

/**
 * Reads tenant-scoped alert dispositions in reverse chronological order.
 */
export async function readAlertDispositions(
    request: AlertDispositionQuery & {
        tenantId: string;
    },
): Promise<AlertDispositionResponse[]> {
    const rows = await db
        .select()
        .from(alertDisposition)
        .where(eq(alertDisposition.tenantId, request.tenantId))
        .orderBy(desc(alertDisposition.createdAt), desc(alertDisposition.id))
        .limit(request.limit);

    return rows.map(toAlertDispositionResponse);
}

/**
 * Allows only internal tenant roles to manage alert dispositions.
 */
export function requireDispositionAccess(req: Request): void {
    const roles = req.auth?.roles ?? [];
    if (
        !roles.some(
            (role) => role === "Finance Admin" || role === "Department Manager",
        )
    ) {
        throw new ForbiddenError("Alert disposition access is limited to internal roles.");
    }
}

function toNewAlertDisposition(
    request: CreateAlertDispositionInboundRequest & {
        tenantId: string;
        investigatedBy: string;
    },
): NewAlertDisposition {
    return {
        tenantId: request.tenantId,
        alertId: request.alertId,
        alertName: request.alertName,
        source: request.source,
        severity: request.severity,
        status: request.status,
        resolution: request.resolution,
        correlationId: request.correlationId ?? null,
        traceId: request.traceId ?? null,
        investigatedBy: request.investigatedBy,
        notes: request.notes ?? null,
        resolvedAt: request.status === "resolved" ? new Date() : null,
    };
}

function toAlertDispositionResponse(
    row: AlertDisposition,
): AlertDispositionResponse {
    return AlertDispositionResponseSchema.parse({
        id: row.id,
        tenantId: row.tenantId,
        alertId: row.alertId,
        alertName: row.alertName,
        source: row.source,
        severity: row.severity,
        status: row.status,
        resolution: row.resolution,
        correlationId: row.correlationId,
        traceId: row.traceId,
        investigatedBy: row.investigatedBy,
        notes: row.notes,
        resolvedAt: row.resolvedAt,
        createdAt: row.createdAt,
    });
}
