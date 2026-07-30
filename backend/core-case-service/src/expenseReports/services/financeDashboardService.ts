import { db } from "../../db/client.js";
import { readFinanceDashboardTrend as readPostgresFinanceDashboardTrend } from "../../db/queries/financeDashboardTrends.js";
import {
    ReadFinanceDashboardTrendInboundRequestSchema,
    type FinanceDashboardTrendPoint,
    type ReadFinanceDashboardTrendParams,
} from "../dto/expenseReportDto.js";

export type FinanceDashboardTrendStore = {
    readFinanceDashboardTrend(
        params: ReadFinanceDashboardTrendParams,
    ): Promise<FinanceDashboardTrendPoint[]>;
};

export type FinanceDashboardServiceDependencies = {
    trendStore: FinanceDashboardTrendStore;
};

/**
 * Reads tenant-scoped Finance Dashboard report volume and spend trends.
 */
export async function readFinanceDashboardTrend(
    request: ReadFinanceDashboardTrendParams,
    dependencies: FinanceDashboardServiceDependencies = {
        trendStore: {
            readFinanceDashboardTrend: (params) =>
                readPostgresFinanceDashboardTrend(db, params),
        },
    },
): Promise<FinanceDashboardTrendPoint[]> {
    const parsedRequest =
        ReadFinanceDashboardTrendInboundRequestSchema.parse(request);

    return dependencies.trendStore.readFinanceDashboardTrend(parsedRequest);
}
