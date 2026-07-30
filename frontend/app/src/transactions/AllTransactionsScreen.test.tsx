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
const defaultReportMetadata = {
    owner: userId,
    priority: "Normal",
    dueDate: "2026-08-01",
    onHold: false,
    isOverdue: false,
} satisfies Pick<
    AllTransaction,
    "owner" | "priority" | "dueDate" | "onHold" | "isOverdue"
>;

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
                glCode: "6250",
                flaggedLineItem: false,
                reviewAction: null,
                ...defaultReportMetadata,
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
                glCode: "6310",
                flaggedLineItem: false,
                reviewAction: "approve",
                ...defaultReportMetadata,
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
                name: /Jul 20, 2026 CF8EA46A Cedar Bistro Meals \$64\.20 AP Review/i,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Jul 18, 2026 CF8EA46A Northstar Office Office Supplies \$92\.41 Submitted/i,
            }),
        ).toBeTruthy();
        expect(screen.getByText("Showing 2 line items")).toBeTruthy();
    });

    test("replaces already-loaded rows when a page refetch returns newer transactions", async () => {
        const originalTransactions: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000176",
                expenseReportId: "60000000-0000-4000-8000-000000000176",
                date: "2026-07-20T12:00:00.000Z",
                merchant: "Cedar Bistro",
                category: "Meals",
                amount: "64.20",
                currency: "USD",
                status: "AP Review",
                glCode: "6250",
                flaggedLineItem: false,
                reviewAction: null,
                ...defaultReportMetadata,
            },
        ];
        const updatedTransactions: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000177",
                expenseReportId: "60000000-0000-4000-8000-000000000177",
                date: "2026-07-21T12:00:00.000Z",
                merchant: "Skyline Supply",
                category: "Office Supplies",
                amount: "118.75",
                currency: "USD",
                status: "Submitted",
                glCode: "6310",
                flaggedLineItem: false,
                reviewAction: "approve",
                ...defaultReportMetadata,
            },
        ];
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                createJsonResponse(
                    createTransactionPage(originalTransactions),
                ),
            )
            .mockResolvedValueOnce(
                createJsonResponse(
                    createTransactionPage(updatedTransactions),
                ),
            );
        const queryClient = createNoRetryQueryClient();

        renderAllTransactionsScreen(fetchImplementation, queryClient);

        expect(await screen.findByText("Cedar Bistro")).toBeTruthy();

        await queryClient.invalidateQueries();

        expect(await screen.findByText("Skyline Supply")).toBeTruthy();
        expect(screen.queryByText("Cedar Bistro")).toBeNull();
        expect(screen.getByText("Showing 1 line items")).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });

    test("opens a report review modal from a row Review button", async () => {
        const transactions: AllTransaction[] = [
            {
                id: "30000000-0000-4000-8000-000000000178",
                expenseReportId: "60000000-0000-4000-8000-000000000178",
                date: "2026-07-20T12:00:00.000Z",
                merchant: "Summit Air",
                category: "Travel",
                amount: "512.09",
                currency: "USD",
                status: "AP Review",
                glCode: "6220",
                flaggedLineItem: true,
                reviewAction: "reject",
                owner: userId,
                priority: "Urgent",
                dueDate: "2026-07-01",
                onHold: true,
                isOverdue: true,
            },
        ];
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse(createTransactionPage(transactions)),
            ),
        );

        renderAllTransactionsScreen(fetchImplementation);

        const summitRow = await screen.findByRole("row", {
            name: /Summit Air Travel \$512\.09 AP Review Review/i,
        });
        fireEvent.click(
            within(summitRow).getByRole("button", { name: "Review" }),
        );

        const dialog = screen.getByRole("dialog", {
            name: /Expense Report 60000000/i,
        });
        expect(
            within(dialog).getByRole("list", {
                name: "Expense Report stage progress",
            }),
        ).toBeTruthy();
        const summary = within(dialog).getByRole("complementary", {
            name: "Expense Report case summary",
        });
        expect(
            within(summary).getByText(userId.slice(0, 8).toUpperCase()),
        ).toBeTruthy();
        expect(within(summary).getByText("Urgent")).toBeTruthy();
        expect(within(summary).getByText("Jul 01, 2026")).toBeTruthy();
        expect(within(summary).getByText("Overdue")).toBeTruthy();
        expect(within(summary).getByText("On hold")).toBeTruthy();
        expect(within(dialog).getByRole("status").textContent).toBe("Paused");
        expect(
            within(dialog).getByRole("table", {
                name: "Expense Report review line items",
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Summit Air \$512\.09 - 6220 Over \$500 Rejected/i,
            }),
        ).toBeTruthy();

        fireEvent.click(within(dialog).getByRole("button", { name: "Exit" }));

        expect(screen.queryByRole("dialog")).toBeNull();
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
                glCode: "6250",
                flaggedLineItem: false,
                reviewAction: null,
                ...defaultReportMetadata,
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
                glCode: "6310",
                flaggedLineItem: false,
                reviewAction: "approve",
                ...defaultReportMetadata,
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
                name: /Jul 20, 2026 CF8EA46A Cedar Bistro Meals \$64\.20 AP Review/i,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Jul 18, 2026 CF8EA46A Northstar Office Office Supplies \$92\.41 Submitted/i,
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
                glCode: "6250",
                flaggedLineItem: false,
                reviewAction: null,
                ...defaultReportMetadata,
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
                glCode: "6310",
                flaggedLineItem: false,
                reviewAction: "approve",
                ...defaultReportMetadata,
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
