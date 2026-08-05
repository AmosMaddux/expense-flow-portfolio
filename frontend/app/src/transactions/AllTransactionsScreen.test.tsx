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
    deriveDisplayedTransactionPages,
    type AllTransaction,
    type AllTransactionPage,
    type ExpenseReportReviewDetail,
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

function readRequestInput(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return input;
    }

    if (input instanceof URL) {
        return input.href;
    }

    if (input instanceof Request) {
        return input.url;
    }

    return "";
}

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolvePromise: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });

    return { promise, resolve: resolvePromise };
}

function createTransactionPage(
    items: AllTransaction[],
    nextCursor: string | null = null,
): AllTransactionPage {
    return { items, nextCursor };
}

function createReportDetail(
    transaction: AllTransaction,
    overrides: Partial<ExpenseReportReviewDetail> = {},
): ExpenseReportReviewDetail {
    return {
        expenseReportId: transaction.expenseReportId,
        owner: transaction.owner,
        priority: transaction.priority,
        dueDate: transaction.dueDate,
        status: transaction.status,
        onHold: transaction.onHold,
        isOverdue: transaction.isOverdue,
        lineItems: [
            {
                id: transaction.id,
                merchant: transaction.merchant,
                category: transaction.category,
                date: transaction.date.slice(0, 10),
                amount: transaction.amount,
                currency: transaction.currency,
                glCode: transaction.glCode,
                flaggedLineItem: transaction.flaggedLineItem,
                reviewAction: transaction.reviewAction,
                deductible: null,
            },
        ],
        mileageEntries: [],
        ...overrides,
    };
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
                createJsonResponse(createTransactionPage(originalTransactions)),
            )
            .mockResolvedValueOnce(
                createJsonResponse(createTransactionPage(updatedTransactions)),
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
        const reportDetail = createReportDetail(transactions[0]);
        const fetchImplementation = vi.fn<typeof fetch>((input) =>
            Promise.resolve(
                readRequestInput(input).includes("/review-detail")
                    ? createJsonResponse(reportDetail)
                    : createJsonResponse(createTransactionPage(transactions)),
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
            await within(dialog).findByRole("list", {
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
        expect(fetchImplementation).toHaveBeenCalledWith(
            "/v1/expense-reports/60000000-0000-4000-8000-000000000178/review-detail",
            expect.objectContaining({}),
        );

        fireEvent.click(within(dialog).getByRole("button", { name: "Exit" }));

        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("loads report detail from all report sources instead of visible transaction rows", async () => {
        const visibleTransaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000188",
            expenseReportId: "60000000-0000-4000-8000-000000000188",
            date: "2026-07-20T12:00:00.000Z",
            merchant: "Summit Air",
            category: "Travel",
            amount: "512.09",
            currency: "USD",
            status: "AP Review",
            glCode: "6220",
            flaggedLineItem: true,
            reviewAction: "approve",
            ...defaultReportMetadata,
        };
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                createJsonResponse(createTransactionPage([visibleTransaction])),
            )
            .mockResolvedValueOnce(
                createJsonResponse(
                    createReportDetail(visibleTransaction, {
                        lineItems: [
                            {
                                id: visibleTransaction.id,
                                merchant: "Summit Air",
                                category: "Travel",
                                date: "2026-07-20",
                                amount: "512.09",
                                currency: "USD",
                                glCode: "6220",
                                flaggedLineItem: true,
                                reviewAction: "approve",
                                deductible: null,
                            },
                            {
                                id: "30000000-0000-4000-8000-000000000189",
                                merchant: "Cedar Bistro",
                                category: "Meals",
                                date: "2026-07-19",
                                amount: "48.33",
                                currency: "USD",
                                glCode: "6250",
                                flaggedLineItem: false,
                                reviewAction: null,
                                deductible: null,
                            },
                        ],
                    }),
                ),
            );

        renderAllTransactionsScreen(fetchImplementation);

        const visibleRow = await screen.findByRole("row", {
            name: /Summit Air Travel \$512\.09 AP Review Review/i,
        });
        fireEvent.click(
            within(visibleRow).getByRole("button", { name: "Review" }),
        );

        const dialog = await screen.findByRole("dialog", {
            name: /Expense Report 60000000/i,
        });

        expect(
            await within(dialog).findByRole("row", {
                name: /Summit Air \$512\.09 - 6220 Over \$500 Approved/i,
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Cedar Bistro \$48\.33 - 6250 Clear Not reviewed/i,
            }),
        ).toBeTruthy();
        expect(screen.getByText("Showing 1 line items")).toBeTruthy();
    });

    test("renders Audit Trail and Comments tabs and posts a comment", async () => {
        const transaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000190",
            expenseReportId: "60000000-0000-4000-8000-000000000190",
            date: "2026-07-20T12:00:00.000Z",
            merchant: "Summit Air",
            category: "Travel",
            amount: "512.09",
            currency: "USD",
            status: "AP Review",
            glCode: "6220",
            flaggedLineItem: true,
            reviewAction: "approve",
            ...defaultReportMetadata,
        };
        const createdComment = {
            id: "70000000-0000-4000-8000-000000000190",
            tenantId,
            expenseReportId: transaction.expenseReportId,
            authorId: userId,
            body: "Synthetic dispute comment from finance.",
            createdAt: "2026-07-22T14:00:00.000Z",
        };
        const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
            const requestUrl = readRequestInput(input);

            if (requestUrl.includes("/audit-entries")) {
                return Promise.resolve(
                    createJsonResponse([
                        {
                            id: "71000000-0000-4000-8000-000000000190",
                            tenantId,
                            expenseReportId: transaction.expenseReportId,
                            actorId: userId,
                            action: "transition_approved",
                            stageBeforeAction: "Submitted",
                            stageAfterProposedAction: "Manager Approval",
                            denialReason: null,
                            outcomeReason: null,
                            createdAt: "2026-07-22T12:00:00.000Z",
                        },
                    ]),
                );
            }

            if (requestUrl.includes("/comments") && init?.method === "POST") {
                return Promise.resolve(
                    createJsonResponse(createdComment, { status: 201 }),
                );
            }

            if (requestUrl.includes("/comments")) {
                return Promise.resolve(
                    createJsonResponse([
                        {
                            id: "72000000-0000-4000-8000-000000000190",
                            tenantId,
                            expenseReportId: transaction.expenseReportId,
                            authorId: userId,
                            body: "Synthetic employee dispute.",
                            createdAt: "2026-07-22T13:00:00.000Z",
                        },
                    ]),
                );
            }

            return Promise.resolve(
                requestUrl.includes("/review-detail")
                    ? createJsonResponse(createReportDetail(transaction))
                    : createJsonResponse(createTransactionPage([transaction])),
            );
        });

        renderAllTransactionsScreen(fetchImplementation);

        const row = await screen.findByRole("row", {
            name: /Summit Air Travel \$512\.09 AP Review Review/i,
        });
        fireEvent.click(within(row).getByRole("button", { name: "Review" }));
        const dialog = await screen.findByRole("dialog", {
            name: /Expense Report 60000000/i,
        });
        expect(
            fetchImplementation.mock.calls.some(([input]) =>
                readRequestInput(input).includes("/audit-entries"),
            ),
        ).toBe(false);
        expect(
            fetchImplementation.mock.calls.some(([input]) =>
                readRequestInput(input).includes("/comments"),
            ),
        ).toBe(false);

        fireEvent.click(
            await within(dialog).findByRole("tab", { name: "Audit Trail" }),
        );
        expect(
            await within(dialog).findByText("Transition Approved"),
        ).toBeTruthy();
        expect(within(dialog).queryByRole("textbox")).toBeNull();

        fireEvent.click(within(dialog).getByRole("tab", { name: "Comments" }));
        expect(
            await within(dialog).findByText("Synthetic employee dispute."),
        ).toBeTruthy();
        fireEvent.change(within(dialog).getByLabelText("Comment"), {
            target: { value: "Synthetic dispute comment from finance." },
        });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Post comment" }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledWith(
                `/v1/expense-reports/${transaction.expenseReportId}/comments`,
                expect.objectContaining({
                    body: JSON.stringify({
                        body: "Synthetic dispute comment from finance.",
                    }),
                    method: "POST",
                }),
            ),
        );
        expect(
            await within(dialog).findByText(
                "Synthetic dispute comment from finance.",
            ),
        ).toBeTruthy();
        expect(
            fetchImplementation.mock.calls.filter(([input, init]) => {
                const requestUrl = readRequestInput(input);
                return (
                    requestUrl.includes("/comments") && init?.method !== "POST"
                );
            }),
        ).toHaveLength(1);
    });

    test("keeps a posted comment visible when the initial comments query resolves later", async () => {
        const transaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000192",
            expenseReportId: "60000000-0000-4000-8000-000000000192",
            date: "2026-07-20T12:00:00.000Z",
            merchant: "Summit Air",
            category: "Travel",
            amount: "512.09",
            currency: "USD",
            status: "AP Review",
            glCode: "6220",
            flaggedLineItem: true,
            reviewAction: "approve",
            ...defaultReportMetadata,
        };
        const initialCommentsResponse = createDeferred<Response>();
        const createdComment = {
            id: "70000000-0000-4000-8000-000000000192",
            tenantId,
            expenseReportId: transaction.expenseReportId,
            authorId: userId,
            body: "Synthetic finance comment before stale GET.",
            createdAt: "2026-07-22T14:00:00.000Z",
        };
        const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
            const requestUrl = readRequestInput(input);

            if (requestUrl.includes("/comments") && init?.method === "POST") {
                return Promise.resolve(
                    createJsonResponse(createdComment, { status: 201 }),
                );
            }

            if (requestUrl.includes("/comments")) {
                return initialCommentsResponse.promise;
            }

            return Promise.resolve(
                requestUrl.includes("/review-detail")
                    ? createJsonResponse(createReportDetail(transaction))
                    : createJsonResponse(createTransactionPage([transaction])),
            );
        });

        renderAllTransactionsScreen(fetchImplementation);

        const row = await screen.findByRole("row", {
            name: /Summit Air Travel \$512\.09 AP Review Review/i,
        });
        fireEvent.click(within(row).getByRole("button", { name: "Review" }));
        const dialog = await screen.findByRole("dialog", {
            name: /Expense Report 60000000/i,
        });
        fireEvent.click(
            await within(dialog).findByRole("tab", { name: "Comments" }),
        );
        fireEvent.change(within(dialog).getByLabelText("Comment"), {
            target: { value: "Synthetic finance comment before stale GET." },
        });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Post comment" }),
        );

        expect(
            await within(dialog).findByText(
                "Synthetic finance comment before stale GET.",
            ),
        ).toBeTruthy();

        initialCommentsResponse.resolve(createJsonResponse([]));
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        await waitFor(() =>
            expect(
                within(dialog).getByText(
                    "Synthetic finance comment before stale GET.",
                ),
            ).toBeTruthy(),
        );
    });

    test("prevents blank comment submissions in the Comments tab", async () => {
        const transaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000191",
            expenseReportId: "60000000-0000-4000-8000-000000000191",
            date: "2026-07-20T12:00:00.000Z",
            merchant: "Summit Air",
            category: "Travel",
            amount: "512.09",
            currency: "USD",
            status: "AP Review",
            glCode: "6220",
            flaggedLineItem: true,
            reviewAction: "approve",
            ...defaultReportMetadata,
        };
        const fetchImplementation = vi.fn<typeof fetch>((input) => {
            const requestUrl = readRequestInput(input);

            if (requestUrl.includes("/audit-entries")) {
                return Promise.resolve(createJsonResponse([]));
            }

            if (requestUrl.includes("/comments")) {
                return Promise.resolve(createJsonResponse([]));
            }

            return Promise.resolve(
                requestUrl.includes("/review-detail")
                    ? createJsonResponse(createReportDetail(transaction))
                    : createJsonResponse(createTransactionPage([transaction])),
            );
        });

        renderAllTransactionsScreen(fetchImplementation);

        const row = await screen.findByRole("row", {
            name: /Summit Air Travel \$512\.09 AP Review Review/i,
        });
        fireEvent.click(within(row).getByRole("button", { name: "Review" }));
        const dialog = await screen.findByRole("dialog", {
            name: /Expense Report 60000000/i,
        });
        fireEvent.click(
            await within(dialog).findByRole("tab", { name: "Comments" }),
        );
        fireEvent.change(await within(dialog).findByLabelText("Comment"), {
            target: { value: "   " },
        });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Post comment" }),
        );

        expect(
            await within(dialog).findByText("Enter a comment before posting."),
        ).toBeTruthy();
        expect(
            fetchImplementation.mock.calls.filter(
                ([input, init]) =>
                    readRequestInput(input).includes("/comments") &&
                    init?.method === "POST",
            ),
        ).toHaveLength(0);
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

describe("deriveDisplayedTransactionPages", () => {
    test("includes the current query page before loaded pagination state catches up", () => {
        const loadedTransaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000190",
            expenseReportId: "60000000-0000-4000-8000-000000000190",
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
        };
        const currentTransaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000191",
            expenseReportId: "60000000-0000-4000-8000-000000000191",
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
        };

        const displayedPages = deriveDisplayedTransactionPages(
            [
                {
                    cursor: null,
                    page: createTransactionPage(
                        [loadedTransaction],
                        "synthetic-cursor",
                    ),
                },
            ],
            "synthetic-cursor",
            createTransactionPage([currentTransaction]),
        );

        expect(displayedPages).toHaveLength(2);
        expect(displayedPages[1]).toEqual({
            cursor: "synthetic-cursor",
            page: createTransactionPage([currentTransaction]),
        });
        expect(
            displayedPages.flatMap((loadedPage) => loadedPage.page.items),
        ).toEqual([loadedTransaction, currentTransaction]);
    });

    test("does not duplicate a query page that already exists in loaded pagination state", () => {
        const currentTransaction: AllTransaction = {
            id: "30000000-0000-4000-8000-000000000192",
            expenseReportId: "60000000-0000-4000-8000-000000000192",
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
        };
        const loadedPages = [
            {
                cursor: "synthetic-cursor",
                page: createTransactionPage([currentTransaction]),
            },
        ];

        expect(
            deriveDisplayedTransactionPages(
                loadedPages,
                "synthetic-cursor",
                createTransactionPage([]),
            ),
        ).toBe(loadedPages);
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
