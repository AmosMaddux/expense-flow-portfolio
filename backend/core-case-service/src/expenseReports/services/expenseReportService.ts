import { randomUUID } from "node:crypto";

import { loadAuthJwtConfig } from "../../config/authJwtConfig.js";
import { loadDefaultGlCodingConfig } from "../../config/glCodingConfig.js";
import {
    BadGatewayError,
    ConflictError,
    ConfigurationError,
    ForbiddenError,
    NotFoundError,
} from "../../errors/problem-json.js";
import { signAccessToken } from "../../auth/shared/accessTokenSigner.js";
import type { RoleName } from "../../db/schema/index.js";
import { codeExpenseLineItems } from "../../glCoding/glCodingClient.js";
import { GlCodingServiceError } from "../../glCoding/glCodingErrors.js";
import {
    buildSubmissionSourceKeys,
    buildSubmissionSourceFingerprint,
    clearExpenseReportFlags as clearExpenseReportFlagsInStore,
    findAuditEntriesByExpenseReportId,
    findExpenseReportById,
    insertDraftExpenseReport,
    insertDeniedFlagClearAuditEntry,
    insertDeniedSubmissionAuditEntry,
    insertDeniedWorkflowTransitionAttempt,
    readDraftSubmissionSources,
    submitDraftExpenseReport,
    transitionExpenseReportStage as transitionExpenseReportStageInStore,
} from "../repository/expenseReportRepository.js";
import { invalidateCachedCaseQueueStageRollups } from "./caseQueueService.js";
import {
    AuditEntryOutboundResponseSchema,
    type AuditEntryResponse,
    type ClearExpenseReportFlagsRequest,
    type CreateExpenseReportRequest,
    type ExpenseReportResponse,
    type GetExpenseReportRequest,
    type TransitionExpenseReportWorkflowRequest,
} from "../../schemas/expense-report.schema.js";

/**
 * Creates a Drafted Expense Report and returns the public API response shape.
 */
export async function createDraftExpenseReport(
    request: CreateExpenseReportRequest & {
        id?: string;
        tenantId: string;
        actorId: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await insertDraftExpenseReport(
        request.tenantId,
        {
            ...(request.id === undefined ? {} : { id: request.id }),
            tenantId: request.tenantId,
            owner: request.owner,
            dueDate: request.dueDate,
            priority: request.priority,
            currentStage: "Drafted",
        },
        request.actorId,
    );

    if (report === undefined) {
        throw new Error("Unable to create Expense Report.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Reads an Expense Report by case identifier and returns the public API response shape.
 */
export async function readExpenseReport(
    request: GetExpenseReportRequest & {
        tenantId: string;
        ownerId?: string;
    },
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(report);
}

/**
 * Submits a Drafted Expense Report after appending GL-coding results.
 */
export async function submitExpenseReport(request: {
    id: string;
    tenantId: string;
    actorId: string;
    roles: RoleName[];
}): Promise<ExpenseReportResponse> {
    const sources = await readDraftSubmissionSources(
        request.tenantId,
        request.id,
    );
    if (sources === undefined) {
        const existing = await findExpenseReportById(
            request.tenantId,
            request.id,
        );
        if (existing === undefined) {
            throw new NotFoundError("Expense Report not found.");
        }

        await insertDeniedSubmissionAuditEntry(
            request.tenantId,
            request.id,
            request.actorId,
            "Only Drafted Expense Reports can be submitted.",
        );
        throw new ConflictError(
            "Only Drafted Expense Reports can be submitted.",
        );
    }

    const authConfig = loadAuthJwtConfig();
    const glConfig = loadDefaultGlCodingConfig();
    const { accessToken } = signAccessToken(
        {
            tenantId: request.tenantId,
            userId: request.actorId,
            roles: request.roles,
        },
        authConfig,
        new Date(),
    );
    try {
        const glResponse = await codeExpenseLineItems(
            glConfig.GL_CODING_SERVICE_BASE_URL,
            {
                line_items: sources.lineItems.map((item) => ({
                    line_item_id: item.id,
                    merchant: item.merchant,
                    amount: item.amount,
                    currency: item.currency,
                    category: item.category as Parameters<
                        typeof codeExpenseLineItems
                    >[1]["line_items"][number]["category"],
                })),
                mileage: sources.mileageEntries.map((entry) => ({
                    mileage_entry_id: entry.id,
                    route: entry.route,
                    distance: entry.distance,
                    mileage_date: entry.mileageDate,
                })),
            },
            {
                accessToken,
                timeoutMs: glConfig.GL_CODING_TIMEOUT_MS,
                maxRetries: glConfig.GL_CODING_MAX_RETRIES,
                baseBackoffMs: glConfig.GL_CODING_BASE_BACKOFF_MS,
                maxBackoffMs: glConfig.GL_CODING_MAX_BACKOFF_MS,
            },
        );
        const report = await submitDraftExpenseReport(
            request.tenantId,
            request.id,
            request.actorId,
            randomUUID(),
            glResponse,
            buildSubmissionSourceKeys(sources),
            buildSubmissionSourceFingerprint(sources),
        );
        if (report === undefined) {
            await insertDeniedSubmissionAuditEntry(
                request.tenantId,
                request.id,
                request.actorId,
                "Only Drafted Expense Reports can be submitted.",
            );
            throw new ConflictError(
                "Only Drafted Expense Reports can be submitted.",
            );
        }

        await invalidateCachedCaseQueueStageRollups(request.tenantId);

        return toExpenseReportResponse(report);
    } catch (error: unknown) {
        if (error instanceof GlCodingServiceError) {
            throw new BadGatewayError(error.message);
        }

        if (error instanceof ConfigurationError) {
            throw error;
        }

        throw error;
    }
}

/**
 * Clears reviewed line-item flags for an Expense Report.
 */
export async function clearExpenseReportFlags(
    request: ClearExpenseReportFlagsRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
    },
): Promise<{ clearedFlagCount: number }> {
    const report = await findExpenseReportById(request.tenantId, request.id);
    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    if (!canReviewWorkflow(request.roles)) {
        await insertDeniedFlagClearAuditEntry({
            tenantId: request.tenantId,
            expenseReportId: request.id,
            actorId: request.actorId,
            outcomeReason:
                "Authenticated role is not permitted to clear line-item flags.",
        });
        throw new ForbiddenError();
    }

    const clearResult = await clearExpenseReportFlagsInStore({
        tenantId: request.tenantId,
        expenseReportId: request.id,
        actorId: request.actorId,
        sourceIds: request.sourceIds,
        reason: request.reason,
    });

    if (clearResult.kind === "not_found") {
        throw new NotFoundError("Expense Report not found.");
    }

    if (clearResult.kind === "invalid_stage") {
        throw new ConflictError(
            `Line-item flags can only be cleared during Manager Approval; Expense Report is in ${clearResult.currentStage}.`,
        );
    }

    return { clearedFlagCount: clearResult.clearedFlagCount };
}

/**
 * Applies role, sequence, and flag guards before moving an Expense Report stage.
 */
export async function transitionExpenseReportWorkflow(
    request: TransitionExpenseReportWorkflowRequest & {
        id: string;
        tenantId: string;
        actorId: string;
        roles: RoleName[];
    },
): Promise<ExpenseReportResponse> {
    const report = await findExpenseReportById(request.tenantId, request.id);
    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    if (!canReviewWorkflow(request.roles)) {
        await insertDeniedWorkflowTransitionAttempt({
            tenantId: request.tenantId,
            id: request.id,
            actor: request.actorId,
            toStage: request.toStage,
            denialReason:
                "Authenticated role is not permitted to transition Expense Reports.",
        });
        throw new ForbiddenError();
    }

    const didTransition = await transitionExpenseReportStageInStore({
        tenantId: request.tenantId,
        id: request.id,
        actor: request.actorId,
        fromStage: report.currentStage as ExpenseReportStage,
        toStage: request.toStage,
        reason: request.reason,
    });

    if (!didTransition) {
        throw new ConflictError(
            `Expense Report cannot transition from ${report.currentStage} to ${request.toStage}.`,
        );
    }

    await invalidateCachedCaseQueueStageRollups(request.tenantId);

    const transitionedReport = await findExpenseReportById(
        request.tenantId,
        request.id,
    );
    if (transitionedReport === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    return toExpenseReportResponse(transitionedReport);
}
/**
 * Reads the tenant-scoped audit trail entries for an Expense Report case.
 */
export async function readExpenseReportAuditEntries(
    request: GetExpenseReportRequest & {
        tenantId: string;
        ownerId?: string;
    },
): Promise<AuditEntryResponse[]> {
    const report = await findExpenseReportById(
        request.tenantId,
        request.id,
        request.ownerId,
    );

    if (report === undefined) {
        throw new NotFoundError("Expense Report not found.");
    }

    const auditEntries = await findAuditEntriesByExpenseReportId(
        request.tenantId,
        request.id,
    );

    return auditEntries.map((entry) =>
        AuditEntryOutboundResponseSchema.parse({
            id: entry.id,
            tenantId: entry.tenantId,
            expenseReportId: entry.expenseReportId,
            actorId: entry.actorId,
            action: entry.action,
            stageBeforeAction: entry.stageBeforeAction,
            stageAfterProposedAction: entry.stageAfterProposedAction,
            denialReason: entry.denialReason,
            outcomeReason: entry.outcomeReason,
            createdAt: entry.createdAt,
        }),
    );
}

type ExpenseReportStage = ExpenseReportResponse["currentStage"];

function canReviewWorkflow(roles: RoleName[]): boolean {
    return roles.some(
        (role) => role === "Department Manager" || role === "Finance Admin",
    );
}

function toExpenseReportResponse(report: {
    id: string;
    tenantId: string;
    owner: string;
    dueDate: string;
    priority: string;
    currentStage: string;
    onHold: boolean;
    holdReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}): ExpenseReportResponse {
    return {
        id: report.id,
        tenantId: report.tenantId,
        owner: report.owner,
        dueDate: report.dueDate,
        priority: report.priority as ExpenseReportResponse["priority"],
        currentStage:
            report.currentStage as ExpenseReportResponse["currentStage"],
        onHold: report.onHold,
        holdReason: report.holdReason,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
    };
}
