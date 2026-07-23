import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { CaseQueueScreen, type CaseQueueStageRollup } from "./CaseQueueScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");
const asOfDate = "2026-07-22";

function createSession(): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Finance Admin"],
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
    };
}

function createAuthClientMock(): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(createSession())),
        refresh: vi.fn(() => Promise.resolve(createSession())),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function createJsonResponse(
    body: unknown,
    init: ResponseInit = {},
): Response {
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

function renderCaseQueueScreen(
    fetchImplementation: typeof fetch,
    queryClient = createNoRetryQueryClient(),
): void {

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock()}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <CaseQueueScreen asOfDate={asOfDate} />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("CaseQueueScreen", () => {
    test("renders a loading skeleton while the Case Queue fetch is pending", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(
            () => new Promise<Response>(() => undefined),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("status", {
                name: "Loading Case Queue",
            }),
        ).toBeTruthy();
        await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
            `/v1/case-queue/rollups?asOfDate=${asOfDate}`,
        );
        expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toBeInstanceOf(
            Headers,
        );
    });

    test("renders rollup-backed summary and stage rows after a successful fetch", async () => {
        const rollups: CaseQueueStageRollup[] = [
            { currentStage: "Drafted", reportCount: 1, overdueCount: 0 },
            { currentStage: "Submitted", reportCount: 4, overdueCount: 1 },
            {
                currentStage: "Manager Approval",
                reportCount: 3,
                overdueCount: 2,
            },
            { currentStage: "AP Review", reportCount: 2, overdueCount: 1 },
            { currentStage: "Paid", reportCount: 5, overdueCount: 0 },
            { currentStage: "Reconciled", reportCount: 6, overdueCount: 0 },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(rollups)),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "Case Queue" }),
        ).toBeTruthy();
        expect(
            await screen.findByText("4 submitted, 3 manager, 2 AP"),
        ).toBeTruthy();
        expect(screen.getByText("9")).toBeTruthy();
        expect(screen.getByText("Overdue Reviews")).toBeTruthy();
        expect(screen.getByText("Reports past their review due date")).toBeTruthy();
        expect(
            screen.getByRole("table", {
                name: "Stage rollups from the authenticated Case Queue fetch",
            }),
        ).toBeTruthy();
        expect(screen.getByRole("row", { name: /AP Review 2 1/i })).toBeTruthy();
        expect(screen.getByText("Showing 6 workflow stages with 21 total reports")).toBeTruthy();
    });

    test("normalizes returned rollups into canonical workflow-stage order", async () => {
        const rollups: CaseQueueStageRollup[] = [
            { currentStage: "AP Review", reportCount: 2, overdueCount: 1 },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(rollups)),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("row", { name: /Drafted 0 0/i }),
        ).toBeTruthy();
        expect(screen.getByRole("row", { name: /Submitted 0 0/i })).toBeTruthy();
        expect(screen.getByRole("row", { name: /AP Review 2 1/i })).toBeTruthy();
        expect(
            screen.getByText("Showing 6 workflow stages with 2 total reports"),
        ).toBeTruthy();
    });

    test("renders an empty state for an empty rollup response", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([])),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No reports waiting for review",
            }),
        ).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
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

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No reports waiting for review",
            }),
        ).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    test("renders an error state without success or empty content when the fetch fails", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createProblemResponse("Synthetic rollup outage.")),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(await screen.findByText("Synthetic rollup outage.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
        expect(screen.queryByLabelText("Case Queue summary")).toBeNull();
        expect(screen.queryByRole("table")).toBeNull();
        expect(
            screen.queryByRole("region", {
                name: "No reports waiting for review",
            }),
        ).toBeNull();
    });

    test("renders an error state when the response shape is invalid", async () => {
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

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", {
                name: "Unable to load Case Queue",
            }),
        ).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
        expect(
            screen.queryByRole("region", {
                name: "No reports waiting for review",
            }),
        ).toBeNull();
    });

    test("uses the production retry policy before showing a non-auth error", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createProblemResponse("Synthetic retry outage.")),
        );

        renderCaseQueueScreen(
            fetchImplementation,
            createFastProductionRetryQueryClient(),
        );

        await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(3));
        expect(await screen.findByText("Synthetic retry outage.")).toBeTruthy();
        expect(screen.queryByLabelText("Case Queue summary")).toBeNull();
    });

    test("retry re-runs the query and replaces the error state with success content", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createProblemResponse("Synthetic outage."))
            .mockResolvedValueOnce(
                createJsonResponse([
                    {
                        currentStage: "Submitted",
                        overdueCount: 0,
                        reportCount: 2,
                    },
                ]),
            );

        renderCaseQueueScreen(fetchImplementation);

        expect(await screen.findByText("Synthetic outage.")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
        expect(
            await screen.findByRole("row", { name: /Submitted 2 0/i }),
        ).toBeTruthy();
        expect(
            screen.getByText("Showing 6 workflow stages with 2 total reports"),
        ).toBeTruthy();
        expect(screen.queryByText("Synthetic outage.")).toBeNull();
    });
});
