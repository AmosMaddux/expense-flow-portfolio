import { z } from "zod";

import { EXPENSE_REPORT_STAGES, type ExpenseReportStage } from "../components";
import { useExpenseFlowQuery } from "../query/queryClient";

const caseQueueRollupRequestSchema = z.object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const caseQueueStageRollupSchema = z.object({
    currentStage: z.enum(EXPENSE_REPORT_STAGES),
    reportCount: z.number().int().nonnegative(),
    overdueCount: z.number().int().nonnegative(),
});

export const caseQueueStageRollupListSchema = z.array(
    caseQueueStageRollupSchema,
);

export type CaseQueueStageRollup = z.infer<typeof caseQueueStageRollupSchema>;

/**
 * Formats the browser's current local calendar date for Case Queue rollups.
 */
export function getCurrentLocalDate(now = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

/**
 * Fetches authenticated Case Queue rollups for the current tenant.
 */
export function useCaseQueueRollups(asOfDate: string) {
    const request = caseQueueRollupRequestSchema.parse({ asOfDate });
    const queryString = new URLSearchParams(request);

    return useExpenseFlowQuery<CaseQueueStageRollup[]>({
        input: `/v1/case-queue/rollups?${queryString.toString()}`,
        keyParts: ["case-queue", "rollups", request],
        parseResponse: async (response) =>
            caseQueueStageRollupListSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}

/**
 * Returns every workflow stage once, preserving canonical stage order.
 */
export function normalizeCaseQueueRollups(
    rollups: CaseQueueStageRollup[],
): CaseQueueStageRollup[] {
    const countsByStage = new Map<
        ExpenseReportStage,
        Pick<CaseQueueStageRollup, "overdueCount" | "reportCount">
    >();

    for (const rollup of rollups) {
        const existing = countsByStage.get(rollup.currentStage) ?? {
            overdueCount: 0,
            reportCount: 0,
        };
        countsByStage.set(rollup.currentStage, {
            overdueCount: existing.overdueCount + rollup.overdueCount,
            reportCount: existing.reportCount + rollup.reportCount,
        });
    }

    return EXPENSE_REPORT_STAGES.map((stage) => {
        const counts = countsByStage.get(stage);

        return {
            currentStage: stage,
            overdueCount: counts?.overdueCount ?? 0,
            reportCount: counts?.reportCount ?? 0,
        };
    });
}

/**
 * Returns whether the rollup payload represents a tenant with no reports.
 */
export function hasNoCaseQueueReports(
    rollups: CaseQueueStageRollup[],
): boolean {
    return (
        rollups.length === 0 ||
        rollups.every((rollup) => rollup.reportCount === 0)
    );
}
