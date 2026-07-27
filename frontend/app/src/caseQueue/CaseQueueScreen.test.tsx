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
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { CaseQueueScreen, type ApprovalQueueLineItem } from "./CaseQueueScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

const lineItems: ApprovalQueueLineItem[] = [
    {
        id: "a7a69670-b8ad-4850-9d55-4c15db31786f",
        expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db001",
        merchant: "Northstar Hotels",
        amount: 742.18,
        glCode: "6240",
        currentStage: "Manager Approval",
        flaggedLineItem: true,
        reviewAction: null,
        canAdvance: false,
    },
    {
        id: "b21bf320-a041-4ec6-8550-3c2315cc0c68",
        expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db002",
        merchant: "Metro Meals",
        amount: 86.42,
        glCode: "6210",
        currentStage: "Submitted",
        flaggedLineItem: false,
        reviewAction: null,
        canAdvance: false,
    },
    {
        id: "e6f4d30b-20fc-4a72-9e44-190eb7d30c72",
        expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db003",
        merchant: "Zenith Air",
        amount: 512,
        glCode: "6220",
        currentStage: "AP Review",
        flaggedLineItem: true,
        reviewAction: "approve",
        canAdvance: false,
    },
];

function createSession(): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Department Manager"],
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
                <CaseQueueScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

function getBodyRows(): HTMLElement[] {
    return screen.getAllByRole("row").slice(1);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("CaseQueueScreen", () => {
    test("renders a loading skeleton while the Approval Queue fetch is pending", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(
            () => new Promise<Response>(() => undefined),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("status", {
                name: "Loading Approval Queue",
            }),
        ).toBeTruthy();
        await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
            "/v1/case-queue/line-items",
        );
        expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toBeInstanceOf(
            Headers,
        );
    });

    test("renders line item rows with merchant, amount, GL code, stage, and flag indicator", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "Case Queue" }),
        ).toBeTruthy();
        expect(await screen.findByText("Northstar Hotels")).toBeTruthy();
        const table = screen.getByRole("table", {
            name: "Tenant-scoped Approval Queue line items",
        });
        expect(table).toBeTruthy();
        const northstarRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        const metroRow = screen.getByRole("row", {
            name: /Metro Meals/i,
        });
        expect(within(northstarRow).getByText("$742.18")).toBeTruthy();
        expect(within(northstarRow).getByText("6240")).toBeTruthy();
        expect(within(northstarRow).getByText("Manager Approval")).toBeTruthy();
        expect(within(northstarRow).getByText("Over $500")).toBeTruthy();
        expect(within(northstarRow).getByText("Not reviewed")).toBeTruthy();
        expect(within(metroRow).getByText("$86.42")).toBeTruthy();
        expect(within(metroRow).getByText("6210")).toBeTruthy();
        expect(within(metroRow).getByText("Submitted")).toBeTruthy();
        expect(within(metroRow).getByText("Clear")).toBeTruthy();
        expect(within(table).getAllByText("Over $500")).toHaveLength(2);
        expect(
            within(table).getAllByRole("button", { name: "Approve" }),
        ).toHaveLength(3);
        expect(
            screen.getByRole("button", { name: "Start review" }),
        ).toBeTruthy();
        expect(screen.getAllByRole("button", { name: "Advance" })).toHaveLength(
            1,
        );
        expect(
            screen.getAllByRole("button", { name: "Reject / Send back" }),
        ).toHaveLength(1);
        expect(screen.getByText("Showing 3 of 3 line items")).toBeTruthy();
    });

    test("filters line items by stage", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.change(screen.getByLabelText("Filter by stage"), {
            target: { value: "AP Review" },
        });

        expect(screen.getByText("Zenith Air")).toBeTruthy();
        expect(screen.queryByText("Northstar Hotels")).toBeNull();
        expect(screen.queryByText("Metro Meals")).toBeNull();
        expect(screen.getByText("Showing 1 of 3 line items")).toBeTruthy();
    });

    test("filters line items by flag status", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.change(screen.getByLabelText("Filter by flag status"), {
            target: { value: "clear" },
        });

        expect(screen.getByText("Metro Meals")).toBeTruthy();
        expect(screen.queryByText("Northstar Hotels")).toBeNull();
        expect(screen.queryByText("Zenith Air")).toBeNull();
        expect(screen.getByText("Showing 1 of 3 line items")).toBeTruthy();
    });

    test("sorts line items from TanStack table headers", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.click(screen.getByRole("button", { name: "Amount" }));

        await waitFor(() => {
            const rows = getBodyRows();
            expect(within(rows[0]).getByText("Metro Meals")).toBeTruthy();
            expect(within(rows[1]).getByText("Zenith Air")).toBeTruthy();
            expect(within(rows[2]).getByText("Northstar Hotels")).toBeTruthy();
        });
    });

    test("renders an empty state for an empty line-item response", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([])),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No line items waiting for review",
            }),
        ).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    test("renders an error state when the line-item fetch fails", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createProblemResponse("Synthetic line-item outage."),
            ),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByText("Synthetic line-item outage."),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    test("does not retry an invalid line-item response shape with the production retry policy", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse([
                    {
                        currentStage: "Submitted",
                        flaggedLineItem: false,
                        glCode: "6210",
                        id: "b21bf320-a041-4ec6-8550-3c2315cc0c68",
                        merchant: "Metro Meals",
                    },
                ]),
            ),
        );

        renderCaseQueueScreen(
            fetchImplementation,
            createFastProductionRetryQueryClient(),
        );

        expect(
            await screen.findByRole("heading", {
                name: "Unable to load Approval Queue",
            }),
        ).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("retry re-runs the query and replaces the error state with line-item rows", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createProblemResponse("Synthetic outage."))
            .mockResolvedValueOnce(createJsonResponse(lineItems));

        renderCaseQueueScreen(fetchImplementation);

        expect(await screen.findByText("Synthetic outage.")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(await screen.findByText("Northstar Hotels")).toBeTruthy();
        expect(screen.queryByText("Synthetic outage.")).toBeNull();
    });

    test("approves a line item optimistically and rolls back when the API rejects the action", async () => {
        let resolveReviewResponse: (response: Response) => void = () =>
            undefined;
        const reviewResponse = new Promise<Response>((resolve) => {
            resolveReviewResponse = resolve;
        });
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockReturnValueOnce(reviewResponse);

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", {
                name: "Approve",
            }),
        );

        await waitFor(() =>
            expect(
                within(
                    screen.getByRole("row", { name: /Northstar Hotels/i }),
                ).getByText("Approved"),
            ).toBeTruthy(),
        );

        resolveReviewResponse(
            createProblemResponse("Synthetic review failure."),
        );

        expect(
            await screen.findByText("Synthetic review failure."),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("row", { name: /Northstar Hotels/i }),
            ).getByText("Not reviewed"),
        ).toBeTruthy();
    });

    test("clears the last report flag and enables the advance action", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(createJsonResponse({ clearedFlagCount: 1 }));
        vi.spyOn(window, "prompt").mockReturnValue("reviewed receipt detail");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        expect(
            screen
                .getByRole("button", {
                    name: "Advance",
                })
                .hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(
            within(northstarRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        const updatedNorthstarRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        expect(within(updatedNorthstarRow).getByText("Clear")).toBeTruthy();
        expect(
            screen
                .getByRole("button", {
                    name: "Advance",
                })
                .hasAttribute("disabled"),
        ).toBe(false);
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/flags/clear",
        );
    });

    test("rolls back optimistic flag clearing when the API rejects the action", async () => {
        let resolveClearResponse: (response: Response) => void = () =>
            undefined;
        const clearResponse = new Promise<Response>((resolve) => {
            resolveClearResponse = resolve;
        });
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockReturnValueOnce(clearResponse);
        vi.spyOn(window, "prompt").mockReturnValue("reviewed receipt detail");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        await waitFor(() =>
            expect(
                within(
                    screen.getByRole("row", { name: /Northstar Hotels/i }),
                ).getByText("Clear"),
            ).toBeTruthy(),
        );

        resolveClearResponse(createProblemResponse("Synthetic clear failure."));

        expect(
            await screen.findByText("Synthetic clear failure."),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("row", { name: /Northstar Hotels/i }),
            ).getByText("Over $500"),
        ).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("starts review for a Submitted report", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    id: "d104c9ca-9de7-4f85-bb23-ed907e9db002",
                    currentStage: "Manager Approval",
                }),
            );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Metro Meals");
        fireEvent.click(screen.getByRole("button", { name: "Start review" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(
            within(screen.getByRole("row", { name: /Metro Meals/i })).getByText(
                "Manager Approval",
            ),
        ).toBeTruthy();
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db002/transitions",
        );
        const transitionRequestBody =
            fetchImplementation.mock.calls[1]?.[1]?.body;

        expect(typeof transitionRequestBody).toBe("string");
        expect(JSON.parse(transitionRequestBody as string)).toMatchObject({
            toStage: "Manager Approval",
            reason: "manager review started",
        });
    });

    test("rolls back optimistic report transitions when the API rejects the action", async () => {
        let resolveTransitionResponse: (response: Response) => void = () =>
            undefined;
        const transitionResponse = new Promise<Response>((resolve) => {
            resolveTransitionResponse = resolve;
        });
        const clearLineItems = lineItems.map((lineItem) =>
            lineItem.expenseReportId === "d104c9ca-9de7-4f85-bb23-ed907e9db001"
                ? { ...lineItem, flaggedLineItem: false, canAdvance: true }
                : lineItem,
        );
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(clearLineItems))
            .mockReturnValueOnce(transitionResponse);

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.click(screen.getByRole("button", { name: "Advance" }));

        await waitFor(() =>
            expect(
                within(
                    screen.getByRole("row", { name: /Northstar Hotels/i }),
                ).getByText("AP Review"),
            ).toBeTruthy(),
        );

        resolveTransitionResponse(
            createProblemResponse("Synthetic transition failure."),
        );

        expect(
            await screen.findByText("Synthetic transition failure."),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("row", { name: /Northstar Hotels/i }),
            ).getByText("Manager Approval"),
        ).toBeTruthy();
    });

    test("rolls back optimistic send-back transitions when the API rejects the action", async () => {
        let resolveTransitionResponse: (response: Response) => void = () =>
            undefined;
        const transitionResponse = new Promise<Response>((resolve) => {
            resolveTransitionResponse = resolve;
        });
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockReturnValueOnce(transitionResponse);
        vi.spyOn(window, "prompt").mockReturnValue(
            "employee correction needed",
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.click(
            screen.getByRole("button", { name: "Reject / Send back" }),
        );

        await waitFor(() =>
            expect(
                within(
                    screen.getByRole("row", { name: /Northstar Hotels/i }),
                ).getByText("Drafted"),
            ).toBeTruthy(),
        );

        resolveTransitionResponse(
            createProblemResponse("Synthetic send-back failure."),
        );

        expect(
            await screen.findByText("Synthetic send-back failure."),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("row", { name: /Northstar Hotels/i }),
            ).getByText("Manager Approval"),
        ).toBeTruthy();
    });

    test("sends a report back to Drafted with a required reason", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    id: "d104c9ca-9de7-4f85-bb23-ed907e9db001",
                    currentStage: "Drafted",
                }),
            );
        vi.spyOn(window, "prompt").mockReturnValue(
            "employee correction needed",
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            screen.getByRole("button", {
                name: "Reject / Send back",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(
            within(
                screen.getByRole("row", { name: /Northstar Hotels/i }),
            ).getByText("Drafted"),
        ).toBeTruthy();
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/transitions",
        );
    });
});
