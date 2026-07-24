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
import {
    AllTransactionsScreen,
    createAllTransactionsQueryString,
    type AllTransaction,
    type AllTransactionPage,
} from "./AllTransactionsScreen";
import allTransactionsPageContract from "./__fixtures__/allTransactionsPage.contract.json";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

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

function createTransactionPage(
    items: AllTransaction[],
    nextCursor: string | null = null,
): AllTransactionPage {
    return { items, nextCursor };
}

function createNoRetryQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function renderAllTransactionsScreen(
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
                <AllTransactionsScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("AllTransactionsScreen", () => {
    test("renders a loading skeleton while the transaction fetch is pending", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(
            () => new Promise<Response>(() => undefined),
        );

        renderAllTransactionsScreen(fetchImplementation);

        expect(
            await screen.findByRole("status", {
                name: "Loading All Transactions",
            }),
        ).toBeTruthy();
        await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe("/v1/transactions");
    });

    test("renders transaction rows after a successful fetch", async () => {
        const transactions: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000170",
                expenseReportId: "60000000-0000-4000-8000-000000000170",
                date: "2026-07-20T12:00:00.000Z",
                merchant: "Cedar Bistro",
                category: "Meals",
                amount: "64.20",
                currency: "USD",
                status: "AP Review",
                deductible: null,
            },
            {
                id: "30000000-0000-4000-8000-000000000171",
                expenseReportId: "60000000-0000-4000-8000-000000000171",
                date: "2026-07-18T12:00:00.000Z",
                merchant: "Northstar Office",
                category: "Office Supplies",
                amount: "92.41",
                currency: "USD",
                status: "Submitted",
                deductible: true,
            },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse(createTransactionPage(transactions)),
            ),
        );

        renderAllTransactionsScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "Transactions" }),
        ).toBeTruthy();
        expect(
            await screen.findByRole("table", {
                name: /Line items across Expense Reports/i,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Jul 20, 2026 Cedar Bistro Meals \$64\.20 AP Review Not set/i,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Jul 18, 2026 Northstar Office Office Supplies \$92\.41 Submitted Yes/i,
            }),
        ).toBeTruthy();
        expect(screen.getByText("Showing 2 line items")).toBeTruthy();
    });

    test("keeps current rows when already-applied filters are applied again", async () => {
        const transactions: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000174",
                expenseReportId: "60000000-0000-4000-8000-000000000174",
                date: "2026-07-20T12:00:00.000Z",
                merchant: "Cedar Bistro",
                category: "Meals",
                amount: "64.20",
                currency: "USD",
                status: "AP Review",
                deductible: null,
            },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse(createTransactionPage(transactions)),
            ),
        );

        renderAllTransactionsScreen(fetchImplementation);

        expect(await screen.findByText("Cedar Bistro")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));

        expect(screen.getByText("Cedar Bistro")).toBeTruthy();
        expect(screen.getByText("Showing 1 line items")).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledTimes(1);
    });

    test("keeps unfiltered rows when clearing already-empty filters", async () => {
        const transactions: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000175",
                expenseReportId: "60000000-0000-4000-8000-000000000175",
                date: "2026-07-18T12:00:00.000Z",
                merchant: "Northstar Office",
                category: "Office Supplies",
                amount: "92.41",
                currency: "USD",
                status: "Submitted",
                deductible: null,
            },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse(createTransactionPage(transactions)),
            ),
        );

        renderAllTransactionsScreen(fetchImplementation);

        expect(await screen.findByText("Northstar Office")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Clear" }));

        expect(screen.getByText("Northstar Office")).toBeTruthy();
        expect(screen.getByText("Showing 1 line items")).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledTimes(1);
    });

    test("sends filter query params only after filters are applied", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(createTransactionPage([]))),
        );

        renderAllTransactionsScreen(fetchImplementation);

        await screen.findByRole("region", { name: "No transactions found" });
        expect(fetchImplementation).toHaveBeenCalledTimes(1);

        fireEvent.change(screen.getByLabelText("Category"), {
            target: { value: "Meals" },
        });
        fireEvent.change(screen.getByLabelText("Status"), {
            target: { value: "AP Review" },
        });
        fireEvent.change(screen.getByLabelText("Start date"), {
            target: { value: "2026-07-01" },
        });
        fireEvent.change(screen.getByLabelText("End date"), {
            target: { value: "2026-07-31" },
        });

        expect(fetchImplementation).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole("button", { name: "Apply" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledWith(
                "/v1/transactions?category=Meals&status=AP+Review&startDate=2026-07-01&endDate=2026-07-31",
                expect.any(Object),
            ),
        );
    });

    test("renders an empty state for no matching transaction rows", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(createTransactionPage([]))),
        );

        renderAllTransactionsScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No transactions found",
            }),
        ).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    test("renders an error state with retry", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createProblemResponse("Read model failed."))
            .mockResolvedValueOnce(
                createJsonResponse(createTransactionPage([])),
            );

        renderAllTransactionsScreen(fetchImplementation);

        const errorState = await screen.findByRole("region", {
            name: "Error state",
        });
        expect(within(errorState).getByText("Read model failed.")).toBeTruthy();

        fireEvent.click(
            within(errorState).getByRole("button", { name: "Retry" }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(
            await screen.findByRole("region", {
                name: "No transactions found",
            }),
        ).toBeTruthy();
    });

    test("renders an error state when a successful response has an invalid shape", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse([
                    {
                        id: "not-a-uuid",
                        merchant: "Missing required fields",
                    },
                ]),
            ),
        );

        renderAllTransactionsScreen(fetchImplementation);

        const errorState = await screen.findByRole("region", {
            name: "Error state",
        });

        expect(
            within(errorState).getByText(
                "The transaction list could not be loaded. Please retry.",
            ),
        ).toBeTruthy();
    });

    test("renders the backend All Transactions page contract fixture", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(allTransactionsPageContract)),
        );

        renderAllTransactionsScreen(fetchImplementation);

        expect(
            await screen.findByRole("row", {
                name: /Jul 20, 2026 Cedar Bistro Meals \$64\.20 AP Review Not set/i,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Jul 18, 2026 Northstar Office Office Supplies \$92\.41 Submitted Yes/i,
            }),
        ).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledWith(
            "/v1/transactions",
            expect.objectContaining({}),
        );

        const lastRequestInit =
            fetchImplementation.mock.calls[
                fetchImplementation.mock.calls.length - 1
            ]?.[1];
        expect((lastRequestInit?.headers as Headers).get("authorization")).toBe(
            "Bearer synthetic-access-token",
        );
    });

    test("loads the next transaction page with the returned cursor", async () => {
        const firstPage: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000172",
                expenseReportId: "60000000-0000-4000-8000-000000000172",
                date: "2026-07-20T12:00:00.000Z",
                merchant: "Cedar Bistro",
                category: "Meals",
                amount: "64.20",
                currency: "USD",
                status: "AP Review",
                deductible: null,
            },
        ];
        const secondPage: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000173",
                expenseReportId: "60000000-0000-4000-8000-000000000173",
                date: "2026-07-18T12:00:00.000Z",
                merchant: "Northstar Office",
                category: "Office Supplies",
                amount: "92.41",
                currency: "USD",
                status: "Submitted",
                deductible: null,
            },
        ];
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                createJsonResponse(
                    createTransactionPage(firstPage, "synthetic-cursor"),
                ),
            )
            .mockResolvedValueOnce(
                createJsonResponse(createTransactionPage(secondPage)),
            );

        renderAllTransactionsScreen(fetchImplementation);

        expect(await screen.findByText("Cedar Bistro")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Load more" }));

        expect(await screen.findByText("Northstar Office")).toBeTruthy();
        expect(fetchImplementation).toHaveBeenLastCalledWith(
            "/v1/transactions?cursor=synthetic-cursor",
            expect.objectContaining({}),
        );
        expect(screen.getByText("Showing 2 line items")).toBeTruthy();
    });
});

describe("createAllTransactionsQueryString", () => {
    test("omits empty filters and trims category", () => {
        expect(
            createAllTransactionsQueryString({
                category: " Meals ",
                status: "",
                startDate: "",
                endDate: "",
            }),
        ).toBe("category=Meals");
    });

    test("adds an opaque cursor when loading the next page", () => {
        expect(
            createAllTransactionsQueryString(
                {
                    category: "",
                    status: "",
                    startDate: "",
                    endDate: "",
                },
                "synthetic-cursor",
            ),
        ).toBe("cursor=synthetic-cursor");
    });
});
