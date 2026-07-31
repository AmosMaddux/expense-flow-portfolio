import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";
import type { CaseQueueStageRollup } from "../caseQueue/caseQueueRollups";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { FinanceDashboardScreen } from "./FinanceDashboardScreen";
type ChartInstanceMock = {
    config: unknown;
    destroy: ReturnType<typeof vi.fn>;
};

const chartInstances = vi.hoisted((): ChartInstanceMock[] => []);
const chartConstructorMock = vi.hoisted(() =>
    vi.fn(function chartMock(_context: unknown, config: unknown) {
        const instance = {
            config,
            destroy: vi.fn(),
        };
        chartInstances.push(instance);

        return instance;
    }),
);
const chartRegisterMock = vi.hoisted(() => vi.fn());

vi.mock("chart.js", () => ({
    BarElement: {},
    CategoryScale: {},
    Chart: Object.assign(chartConstructorMock, {
        register: chartRegisterMock,
    }),
    Legend: {},
    LinearScale: {},
    Tooltip: {},
}));

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");
const asOfDate = "2026-07-22";
const dashboardStateTimeout = 5_000;

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Finance Admin"],
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
        ...overrides,
    };
}

function createAuthClientMock(session = createSession()): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(session)),
        refresh: vi.fn(() => Promise.resolve(session)),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status: 200,
        ...init,
    });
}

function createProblemResponse(detail: string): Response {
    return createJsonResponse(
        {
            detail,
            status: 500,
            title: "Unexpected server error",
        },
        {
            headers: { "Content-Type": "application/problem+json" },
            status: 500,
        },
    );
}

function createNoRetryQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function createFastProductionRetryQueryClient(): QueryClient {
    const queryClient = createExpenseFlowQueryClient();
    const defaultOptions = queryClient.getDefaultOptions();

    queryClient.setDefaultOptions({
        ...defaultOptions,
        queries: {
            ...defaultOptions.queries,
            retryDelay: 1,
        },
    });

    return queryClient;
}

function renderFinanceDashboardScreen(
    fetchImplementation: typeof fetch,
    queryClient = createNoRetryQueryClient(),
    authClient = createAuthClientMock(),
) {
    return render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={authClient}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <FinanceDashboardScreen asOfDate={asOfDate} />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

function createTrendFetchImplementation(
    trendBody: unknown,
    rollups: CaseQueueStageRollup[] = [
        {
            currentStage: "Submitted",
            overdueCount: 0,
            reportCount: 6,
        },
    ],
): typeof fetch {
    return vi.fn<typeof fetch>((input) => {
        const url = input instanceof Request ? input.url : input.toString();

        if (url.startsWith("/v1/finance-dashboard/trends")) {
            return Promise.resolve(createJsonResponse(trendBody));
        }

        return Promise.resolve(createJsonResponse(rollups));
    });
}

function readChartConfig(index = chartInstances.length - 1): {
    data?: { datasets?: Array<{ data?: number[]; label?: string }> };
} {
    return chartInstances[index]?.config as {
        data?: { datasets?: Array<{ data?: number[]; label?: string }> };
    };
}
function expectKpiCard(label: string, value: string, helper: string): void {
    const card = screen.getByRole("article", { name: `${label} KPI` });

    expect(within(card).getByText(label, { selector: "p" })).toBeTruthy();
    expect(within(card).getByText(value, { selector: "strong" })).toBeTruthy();
    expect(within(card).getByText(helper, { selector: "span" })).toBeTruthy();
}

beforeEach(() => {
    chartInstances.length = 0;
    chartConstructorMock.mockClear();
    chartRegisterMock.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        {} as CanvasRenderingContext2D,
    );
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("FinanceDashboardScreen", () => {
    test("renders a loading skeleton while the dashboard fetch is pending", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(
            () => new Promise<Response>(() => undefined),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByRole("status", {
                name: "Loading Finance Dashboard",
            }),
        ).toBeTruthy();
        await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
            `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
        );
        expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toBeInstanceOf(
            Headers,
        );
        expect(
            (fetchImplementation.mock.calls[0]?.[1]?.headers as Headers).get(
                "Authorization",
            ),
        ).toBe("Bearer synthetic-access-token");
    });

    test("renders stage KPI cards and tenant overdue total from Case Queue rollups", async () => {
        const rollups: CaseQueueStageRollup[] = [
            { currentStage: "Drafted", reportCount: 1, overdueCount: 6 },
            { currentStage: "Submitted", reportCount: 4, overdueCount: 1 },
            {
                currentStage: "Manager Approval",
                reportCount: 3,
                overdueCount: 2,
            },
            { currentStage: "AP Review", reportCount: 2, overdueCount: 1 },
            { currentStage: "Paid", reportCount: 5, overdueCount: 7 },
            { currentStage: "Reconciled", reportCount: 6, overdueCount: 8 },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(rollups)),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByLabelText("Finance Dashboard KPI cards"),
        ).toBeTruthy();
        expect(
            screen.getByRole("heading", { name: "Workload Overview" }),
        ).toBeTruthy();
        expectKpiCard("Drafted", "1", "6 overdue");
        expectKpiCard("Submitted", "4", "1 overdue");
        expectKpiCard("Manager Approval", "3", "2 overdue");
        expectKpiCard("AP Review", "2", "1 overdue");
        expectKpiCard("Paid", "5", "7 overdue");
        expectKpiCard("Reconciled", "6", "8 overdue");
        expectKpiCard("Overdue Total", "25", "21 total reports");
    });

    test("renders report volume and spend trend summary with accessible table", async () => {
        const fetchImplementation = createTrendFetchImplementation([
            {
                periodStart: "2026-07-21",
                reportCount: 2,
                spendByCurrency: [
                    {
                        currency: "USD",
                        spendAmount: "125.50",
                    },
                ],
            },
            {
                periodStart: "2026-07-22",
                reportCount: 4,
                spendByCurrency: [
                    {
                        currency: "USD",
                        spendAmount: "274.50",
                    },
                ],
            },
        ]);

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "Report Trends" }),
        ).toBeTruthy();
        expect(
            screen.getByText(
                "6 reports and $400.00 in spend from Jun 23 to Jul 22; peak volume was 4 reports on Jul 22.",
            ),
        ).toBeTruthy();
        expect(
            screen.getByRole("img", { name: "Report trend chart" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("table", {
                name: "Report volume and spend by day",
            }),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Spend" })).toBeTruthy();
        expect(screen.getByText("$274.50")).toBeTruthy();
        expect(chartConstructorMock).toHaveBeenCalledOnce();
        expect(readChartConfig().data?.datasets?.[0]?.label).toBe(
            "Report volume",
        );
        expect(readChartConfig().data?.datasets?.[0]?.data).toStrictEqual([
            2, 4,
        ]);
    });

    test("rebuilds the Chart.js config when toggling to spend", async () => {
        const fetchImplementation = createTrendFetchImplementation([
            {
                periodStart: "2026-07-21",
                reportCount: 2,
                spendByCurrency: [
                    { currency: "EUR", spendAmount: "20.00" },
                    { currency: "USD", spendAmount: "125.50" },
                ],
            },
            {
                periodStart: "2026-07-22",
                reportCount: 4,
                spendByCurrency: [{ currency: "USD", spendAmount: "274.50" }],
            },
        ]);

        renderFinanceDashboardScreen(fetchImplementation);

        await screen.findByRole("img", { name: "Report trend chart" });
        fireEvent.click(screen.getByRole("button", { name: "Spend" }));

        await waitFor(() =>
            expect(chartConstructorMock).toHaveBeenCalledTimes(2),
        );
        expect(chartInstances[0]?.destroy).toHaveBeenCalledOnce();
        expect(readChartConfig().data?.datasets).toEqual([
            expect.objectContaining({ data: [20, 0], label: "EUR" }),
            expect.objectContaining({ data: [125.5, 274.5], label: "USD" }),
        ]);
    });

    test("destroys the Chart.js instance when the dashboard unmounts", async () => {
        const fetchImplementation = createTrendFetchImplementation([
            {
                periodStart: "2026-07-22",
                reportCount: 4,
                spendByCurrency: [
                    {
                        currency: "USD",
                        spendAmount: "274.50",
                    },
                ],
            },
        ]);
        const rendered = renderFinanceDashboardScreen(fetchImplementation);

        await screen.findByRole("img", { name: "Report trend chart" });
        const chart = chartInstances[0];
        rendered.unmount();

        expect(chart?.destroy).toHaveBeenCalledOnce();
    });

    test("renders a chart empty state when KPI data exists but trend data is empty", async () => {
        const fetchImplementation = createTrendFetchImplementation([
            {
                periodStart: "2026-07-21",
                reportCount: 0,
                spendByCurrency: [],
            },
            {
                periodStart: "2026-07-22",
                reportCount: 0,
                spendByCurrency: [],
            },
        ]);

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByRole(
                "region",
                {
                    name: "No trend data to show",
                },
                { timeout: dashboardStateTimeout },
            ),
        ).toBeTruthy();
        expect(chartConstructorMock).not.toHaveBeenCalled();
    });
    test("normalizes missing stages to zero in canonical stage order", async () => {
        const rollups: CaseQueueStageRollup[] = [
            { currentStage: "AP Review", reportCount: 2, overdueCount: 1 },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(rollups)),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        const kpis = await screen.findByLabelText(
            "Finance Dashboard KPI cards",
        );
        const cards = kpis.querySelectorAll("article");

        expect(cards).toHaveLength(7);
        expectKpiCard("Drafted", "0", "0 overdue");
        expectKpiCard("AP Review", "2", "1 overdue");
        expectKpiCard("Overdue Total", "1", "2 total reports");
    });

    test("keeps dashboard data scoped by authenticated tenant and principal", async () => {
        const tenantASession = createSession({
            tenantId: "11111111-1111-4111-8111-111111111111",
            userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            accessToken: "tenant-a-access-token",
        });
        const tenantBSession = createSession({
            tenantId: "22222222-2222-4222-8222-222222222222",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            accessToken: "tenant-b-access-token",
        });
        const queryClient = createNoRetryQueryClient();
        const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
            const authorization = (init?.headers as Headers).get(
                "Authorization",
            );

            if (authorization === "Bearer tenant-a-access-token") {
                return Promise.resolve(
                    createJsonResponse([
                        {
                            currentStage: "Submitted",
                            overdueCount: 0,
                            reportCount: 1,
                        },
                    ]),
                );
            }

            return Promise.resolve(
                createJsonResponse([
                    {
                        currentStage: "Submitted",
                        overdueCount: 3,
                        reportCount: 9,
                    },
                ]),
            );
        });

        const firstRender = renderFinanceDashboardScreen(
            fetchImplementation,
            queryClient,
            createAuthClientMock(tenantASession),
        );

        await screen.findByRole("article", { name: "Submitted KPI" });
        expectKpiCard("Submitted", "1", "0 overdue");
        firstRender.unmount();

        renderFinanceDashboardScreen(
            fetchImplementation,
            queryClient,
            createAuthClientMock(tenantBSession),
        );

        await screen.findByRole("article", { name: "Submitted KPI" });
        expectKpiCard("Submitted", "9", "3 overdue");
        expect(fetchImplementation).toHaveBeenCalledTimes(4);
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
            `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
        );
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/finance-dashboard/trends?fromDate=2026-06-23&toDate=2026-07-22",
        );
        expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
            `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
        );
        expect(fetchImplementation.mock.calls[3]?.[0]).toBe(
            "/v1/finance-dashboard/trends?fromDate=2026-06-23&toDate=2026-07-22",
        );
        expect(
            (fetchImplementation.mock.calls[0]?.[1]?.headers as Headers).get(
                "Authorization",
            ),
        ).toBe("Bearer tenant-a-access-token");
        expect(
            (fetchImplementation.mock.calls[1]?.[1]?.headers as Headers).get(
                "Authorization",
            ),
        ).toBe("Bearer tenant-a-access-token");
        expect(
            (fetchImplementation.mock.calls[2]?.[1]?.headers as Headers).get(
                "Authorization",
            ),
        ).toBe("Bearer tenant-b-access-token");
        expect(
            (fetchImplementation.mock.calls[3]?.[1]?.headers as Headers).get(
                "Authorization",
            ),
        ).toBe("Bearer tenant-b-access-token");
    });

    test("renders an empty state for an empty rollup response", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([])),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByRole(
                "region",
                {
                    name: "No Expense Reports to show",
                },
                { timeout: dashboardStateTimeout },
            ),
        ).toBeTruthy();
        expect(
            screen.queryByLabelText("Finance Dashboard KPI cards"),
        ).toBeNull();
    });

    test("renders an empty state when every returned stage has zero reports", async () => {
        const rollups: CaseQueueStageRollup[] = [
            { currentStage: "Submitted", reportCount: 0, overdueCount: 0 },
            {
                currentStage: "Manager Approval",
                reportCount: 0,
                overdueCount: 0,
            },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(rollups)),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByRole(
                "region",
                {
                    name: "No Expense Reports to show",
                },
                { timeout: dashboardStateTimeout },
            ),
        ).toBeTruthy();
        expect(
            screen.queryByLabelText("Finance Dashboard KPI cards"),
        ).toBeNull();
    });

    test("renders an error state when the rollup fetch fails", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createProblemResponse("Synthetic dashboard outage."),
            ),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByText("Synthetic dashboard outage."),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
        expect(
            screen.queryByLabelText("Finance Dashboard KPI cards"),
        ).toBeNull();
    });

    test("retry re-runs the query and replaces the error state with KPI cards", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                createProblemResponse("Synthetic dashboard outage."),
            )
            .mockResolvedValueOnce(
                createJsonResponse([
                    {
                        currentStage: "Submitted",
                        overdueCount: 0,
                        reportCount: 2,
                    },
                ]),
            );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByText("Synthetic dashboard outage."),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(
            await screen.findByLabelText("Finance Dashboard KPI cards"),
        ).toBeTruthy();
        expect(screen.queryByText("Synthetic dashboard outage.")).toBeNull();
    });

    test("does not retry an invalid response shape with the production retry policy", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse([
                    {
                        currentStage: "Submitted",
                        overdueCount: 0,
                        reportCount: "not-a-number",
                    },
                ]),
            ),
        );

        renderFinanceDashboardScreen(
            fetchImplementation,
            createFastProductionRetryQueryClient(),
        );

        expect(
            await screen.findByRole("heading", {
                name: "Unable to load Finance Dashboard",
            }),
        ).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });
});
