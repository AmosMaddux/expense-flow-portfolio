import { z } from "zod";

import { useExpenseFlowQuery } from "../query/queryClient";

const financeDashboardTrendRequestSchema = z
    .object({
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .refine((request) => request.fromDate <= request.toDate, {
        message: "fromDate must be on or before toDate.",
        path: ["fromDate"],
    });

const financeDashboardTrendSpendBucketSchema = z.object({
    currency: z.string().min(3).max(8),
    spendAmount: z.string().regex(/^\d{1,12}\.\d{2}$/),
});

const financeDashboardTrendPointSchema = z.object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reportCount: z.number().int().nonnegative(),
    spendByCurrency: z.array(financeDashboardTrendSpendBucketSchema),
});

export const financeDashboardTrendPointListSchema = z.array(
    financeDashboardTrendPointSchema,
);

export type FinanceDashboardTrendPoint = z.infer<
    typeof financeDashboardTrendPointSchema
>;

/**
 * Fetches tenant-scoped Finance Dashboard report volume and spend trends.
 */
export function useFinanceDashboardTrend(
    fromDate: string,
    toDate: string,
    enabled = true,
) {
    const request = financeDashboardTrendRequestSchema.parse({
        fromDate,
        toDate,
    });
    const queryString = new URLSearchParams(request);

    return useExpenseFlowQuery<FinanceDashboardTrendPoint[]>({
        enabled,
        input: `/v1/finance-dashboard/trends?${queryString.toString()}`,
        keyParts: ["finance-dashboard", "trends", request],
        parseResponse: async (response) =>
            financeDashboardTrendPointListSchema.parse(await response.json()),
        staleTime: 30_000,
    });
}
