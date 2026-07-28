import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";
import type { CaseQueueStageRollup } from "../caseQueue/caseQueueRollups";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { FinanceDashboardScreen } from "./FinanceDashboardScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");
const asOfDate = "2026-07-22";

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

function expectKpiCard(label: string, value: string, helper: string): void {
    const card = screen.getByRole("article", { name: `${label} KPI` });

    expect(within(card).getByText(label, { selector: "p" })).toBeTruthy();
    expect(within(card).getByText(value, { selector: "strong" })).toBeTruthy();
    expect(within(card).getByText(helper, { selector: "span" })).toBeTruthy();
}

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
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
            `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
        );
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
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
        ).toBe("Bearer tenant-b-access-token");
    });

    test("renders an empty state for an empty rollup response", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([])),
        );

        renderFinanceDashboardScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No Expense Reports to show",
            }),
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
            await screen.findByRole("region", {
                name: "No Expense Reports to show",
            }),
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
