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
        mileageEntries: [
            {
                id: "f7b2017a-7d30-4d80-a360-53d00f387111",
                expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db001",
                route: "Office to client site",
                distance: 18.5,
                mileageDate: "2026-07-21",
                amount: 12.4,
                glCode: "6250",
            },
        ],
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
        mileageEntries: [],
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
        mileageEntries: [],
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
            name: "Approval Queue line items",
        });
        expect(table).toBeTruthy();
        const northstarRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        const metroRow = screen.getByRole("row", {
            name: /Metro Meals/i,
        });
        expect(within(northstarRow).getByText("$742.18")).toBeTruthy();
        expect(within(northstarRow).getByText("18.50 miles")).toBeTruthy();
        expect(within(northstarRow).getByText("6240")).toBeTruthy();
        expect(within(northstarRow).getByText("Manager Approval")).toBeTruthy();
        expect(within(northstarRow).getByText("Over $500")).toBeTruthy();
        expect(within(metroRow).getByText("$86.42")).toBeTruthy();
        expect(within(metroRow).getByText("6210")).toBeTruthy();
        expect(within(metroRow).getByText("Submitted")).toBeTruthy();
        expect(within(metroRow).getByText("Clear")).toBeTruthy();
        expect(within(table).getAllByText("Over $500")).toHaveLength(2);
        expect(
            within(table).getAllByRole("button", { name: "Review" }),
        ).toHaveLength(3);
        expect(
            within(table).queryByRole("button", { name: "Approve" }),
        ).toBeNull();
        expect(
            within(table).queryByRole("button", { name: "Reject" }),
        ).toBeNull();
        expect(
            within(table).queryByRole("button", { name: "Clear flag" }),
        ).toBeNull();
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

    test("filters line items by the amount-over-threshold checkbox", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.click(screen.getByLabelText("Filter to amount over 500"));

        expect(screen.getByText("Northstar Hotels")).toBeTruthy();
        expect(screen.getByText("Zenith Air")).toBeTruthy();
        expect(screen.queryByText("Metro Meals")).toBeNull();
        expect(screen.getByText("Showing 2 of 3 line items")).toBeTruthy();
    });

    test("sorts line items from TanStack table headers", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.click(screen.getByRole("button", { name: "Total Amount" }));

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

    test("opens a report review popup from the row Review button without navigating", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        window.history.replaceState(null, "", "/approval-queue");
        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );

        expect(window.location.pathname).toBe("/approval-queue");
        expect(
            screen.getByRole("dialog", {
                name: "Report d104c9ca",
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("table", { name: "Report review line items" }),
        ).toBeTruthy();
        const reviewTable = screen.getByRole("table", {
            name: "Report review line items",
        });
        expect(
            within(reviewTable).getByRole("columnheader", { name: "Mileage" }),
        ).toBeTruthy();
        expect(within(reviewTable).getByText("18.50 miles")).toBeTruthy();
        expect(
            screen.queryByRole("table", {
                name: "Report review mileage entries",
            }),
        ).toBeNull();
        expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Clear flag" })).toBeTruthy();
        expect(
            screen.getByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        ).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("pulls a Submitted report into Manager Approval when a manager opens review", async () => {
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

        const metroRow = await screen.findByRole("row", {
            name: /Metro Meals/i,
        });
        fireEvent.click(
            within(metroRow).getByRole("button", { name: "Review" }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(
            screen.getByRole("dialog", {
                name: "Report d104c9ca",
            }),
        ).toBeTruthy();
        expect(screen.getAllByText("Manager Approval").length).toBeGreaterThan(
            0,
        );
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

    test("approves a line item optimistically in the popup and rolls back when the API rejects the action", async () => {
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
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Approve" }));

        await waitFor(() => expect(screen.getByText("Approved")).toBeTruthy());

        resolveReviewResponse(
            createProblemResponse("Synthetic review failure."),
        );

        expect(
            await screen.findByText("Synthetic review failure."),
        ).toBeTruthy();
        expect(screen.getByText("Not reviewed")).toBeTruthy();
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/line-items/a7a69670-b8ad-4850-9d55-4c15db31786f/review",
        );
    });

    test("requires every line item to be reviewed before enabling the advance action", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(createJsonResponse({ clearedFlagCount: 1 }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    flaggedLineItem: false,
                    reviewAction: "approve",
                    canAdvance: true,
                }),
            );
        vi.spyOn(window, "prompt").mockReturnValue("reviewed receipt detail");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Clear flag" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(screen.getAllByText("Clear").length).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Approve" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(3),
        );
        expect(screen.getByText("Approved")).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(false);
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/flags/clear",
        );
        expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/line-items/a7a69670-b8ad-4850-9d55-4c15db31786f/review",
        );
    });

    test("rolls back optimistic flag clearing in the popup when the API rejects the action", async () => {
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
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Clear flag" }));

        await waitFor(() =>
            expect(screen.getAllByText("Clear").length).toBeGreaterThan(0),
        );

        resolveClearResponse(createProblemResponse("Synthetic clear failure."));

        expect(
            await screen.findByText("Synthetic clear failure."),
        ).toBeTruthy();
        expect(screen.getAllByText("Over $500").length).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("sends a report back to Drafted and removes it from the manager queue", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    reviewAction: "reject",
                    canAdvance: false,
                }),
            )
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

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        expect(
            screen
                .getByRole("button", {
                    name: "Reject / Send back to Drafted",
                })
                .hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Reject" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(screen.getByText("Rejected")).toBeTruthy();
        expect(
            screen
                .getByRole("button", {
                    name: "Reject / Send back to Drafted",
                })
                .hasAttribute("disabled"),
        ).toBe(false);

        fireEvent.click(
            screen.getByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(3),
        );
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByText("Northstar Hotels")).toBeNull();
        expect(screen.queryByRole("row", { name: /Drafted/i })).toBeNull();
        expect(screen.getByText("Showing 2 of 2 line items")).toBeTruthy();
        expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/transitions",
        );
        const transitionRequestBody =
            fetchImplementation.mock.calls[2]?.[1]?.body;

        expect(typeof transitionRequestBody).toBe("string");
        expect(JSON.parse(transitionRequestBody as string)).toMatchObject({
            toStage: "Drafted",
            reason: "employee correction needed",
        });
    });

    test("does not expose report send-back after a report reaches AP Review", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        const zenithRow = await screen.findByRole("row", {
            name: /Zenith Air/i,
        });
        fireEvent.click(
            within(zenithRow).getByRole("button", { name: "Review" }),
        );

        expect(
            screen.getByRole("dialog", {
                name: "Report d104c9ca",
            }),
        ).toBeTruthy();
        expect(
            screen.queryByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        ).toBeNull();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("does not send a report back when the required reason is omitted", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );
        vi.spyOn(window, "prompt").mockReturnValue("");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        );

        expect(fetchImplementation).toHaveBeenCalledOnce();
    });
});
