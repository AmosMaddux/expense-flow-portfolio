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
import { ExpenseReportsScreen } from "./ExpenseReportsScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const managerId = "9f1b3f5c-1dc8-4f37-8a23-000000000002";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");
const reportId = "d104c9ca-9de7-4f85-bb23-ed907e9db001";

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

function createSummaryPage(
    items: unknown[],
    nextCursor: string | null = null,
): { items: unknown[]; nextCursor: string | null } {
    return { items, nextCursor };
}

function createNoRetryQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function renderExpenseReportsScreen(fetchImplementation: typeof fetch): void {
    const queryClient = createNoRetryQueryClient();

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock()}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <ExpenseReportsScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("ExpenseReportsScreen", () => {
    test("renders report summaries with the expected table columns", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse(
                        createSummaryPage([
                            {
                                id: reportId,
                                createdAt: "2026-07-20T14:30:00.000Z",
                                employeeId:
                                    "50000000-0000-4000-8000-000000000191",
                                managerId,
                                category: "Travel",
                                categories: ["Travel"],
                                amount: "742.18",
                                currency: "USD",
                                status: "Manager Approval",
                            },
                        ]),
                    ),
                ),
            ),
        );

        expect(
            await screen.findByRole("heading", {
                name: "Expense Reports",
            }),
        ).toBeTruthy();
        expect(
            await screen.findByRole("columnheader", { name: "Date" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("columnheader", { name: "Employee" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("columnheader", { name: "Manager" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("columnheader", { name: "Category" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("columnheader", { name: "Amount" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("columnheader", { name: "Status" }),
        ).toBeTruthy();

        const row = screen.getByRole("row", {
            name: /Manager 9f1b3f5c Travel \$742\.18 Manager Approval/i,
        });
        expect(within(row).getByText("Manager 9f1b3f5c")).toBeTruthy();
        expect(within(row).queryByText(/Pending assignment/i)).toBeNull();
        expect(
            within(row).getByRole("button", { name: "Review" }),
        ).toBeTruthy();
    });

    test("shows a readable message when the API returns an HTML error page", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    new Response(
                        "<!DOCTYPE html><html><body><pre>Cannot GET /v1/expense-reports</pre></body></html>",
                        {
                            headers: { "Content-Type": "text/html" },
                            status: 404,
                        },
                    ),
                ),
            ),
        );

        expect(
            await screen.findByRole("heading", {
                name: "Unable to load Expense Reports",
            }),
        ).toBeTruthy();
        expect(
            screen.getByText(
                "Expense Reports API returned an HTML error page. Check that the Vite /v1 proxy is targeting the core case service.",
            ),
        ).toBeTruthy();
        expect(screen.queryByText(/<!DOCTYPE html>/i)).toBeNull();
    });

    test("renders assigned manager ids without an Employee prefix", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse(
                        createSummaryPage([
                            createSummary({
                                managerId:
                                    "51000000-0000-4000-8000-000000000191",
                            }),
                        ]),
                    ),
                ),
            ),
        );

        const row = await screen.findByRole("row", {
            name: /Manager 51000000 Travel \$742\.18 Manager Approval/i,
        });

        expect(within(row).getByText("Manager 51000000")).toBeTruthy();
        expect(within(row).queryByText("Employee 51000000")).toBeNull();
    });

    test("loads the next server page with the returned cursor", async () => {
        const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
            const query = new URL(
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url,
                "http://localhost",
            ).searchParams;

            if (query.get("cursor") === "synthetic-cursor") {
                return Promise.resolve(
                    createJsonResponse(
                        createSummaryPage([
                            createSummary({
                                id: "60000000-0000-4000-8000-000000000192",
                                amount: "88.34",
                            }),
                        ]),
                    ),
                );
            }

            return Promise.resolve(
                createJsonResponse(
                    createSummaryPage([createSummary()], "synthetic-cursor"),
                ),
            );
        }) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        expect(await screen.findByText("$742.18")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Load more" }));

        await waitFor(() => {
            expect(
                readLastRequestQuery(fetchImplementation).get("cursor"),
            ).toBe("synthetic-cursor");
        });
        expect(await screen.findByText("$88.34")).toBeTruthy();
    });

    test("filters report summaries by date employee category amount and multiple statuses", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                createJsonResponse(
                    createSummaryPage([
                        {
                            id: reportId,
                            createdAt: "2026-07-20T14:30:00.000Z",
                            employeeId: "50000000-0000-4000-8000-000000000191",
                            managerId: null,
                            category: "Travel",
                            categories: ["Travel"],
                            amount: "742.18",
                            currency: "USD",
                            status: "Manager Approval",
                        },
                        {
                            id: "60000000-0000-4000-8000-000000000192",
                            createdAt: "2026-07-20T16:45:00.000Z",
                            employeeId: "60000000-0000-4000-8000-000000000192",
                            managerId: null,
                            category: "Travel",
                            categories: ["Travel"],
                            amount: "245.10",
                            currency: "USD",
                            status: "AP Review",
                        },
                        {
                            id: "70000000-0000-4000-8000-000000000193",
                            createdAt: "2026-07-21T09:15:00.000Z",
                            employeeId: "70000000-0000-4000-8000-000000000193",
                            managerId: null,
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                            currency: "USD",
                            status: "Submitted",
                        },
                    ]),
                ),
            ),
        ) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        expect(await screen.findByText("$742.18")).toBeTruthy();

        const changeFilter = async (label: string, value: string) => {
            fireEvent.change(await screen.findByLabelText(label), {
                target: { value },
            });
        };

        await changeFilter("Date", "2026-07-20");
        await changeFilter("Employee", "50000000");
        await changeFilter("Category", "Travel");
        await changeFilter("Min amount", "500");
        await changeFilter("Max amount", "800");
        fireEvent.click(await screen.findByLabelText("Manager Approval"));
        fireEvent.click(await screen.findByLabelText("AP Review"));

        await waitFor(() => {
            const query = readLastRequestQuery(fetchImplementation);

            expect(query.get("date")).toBe("2026-07-20");
            expect(query.get("employee")).toBe("50000000");
            expect(query.get("category")).toBe("Travel");
            expect(query.get("amountMin")).toBe("500");
            expect(query.get("amountMax")).toBe("800");
            expect(query.getAll("status")).toEqual([
                "Manager Approval",
                "AP Review",
            ]);
        });
    });

    test("filters category selector options while typing", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse(
                        createSummaryPage([
                            createSummary({ category: "Travel" }),
                            createSummary({
                                id: "60000000-0000-4000-8000-000000000192",
                                category: "Meals",
                                categories: ["Meals"],
                                amount: "88.34",
                            }),
                        ]),
                    ),
                ),
            ),
        );

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "tra" },
        });

        expect(screen.getByRole("button", { name: "Travel" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Meals" })).toBeNull();
        expect(screen.getByText("Showing 2")).toBeTruthy();
    });

    test("selects and clears a valid category filter", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                createJsonResponse(
                    createSummaryPage([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ),
        ) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "tra" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Travel" }));

        await waitFor(() => {
            expect(
                readLastRequestQuery(fetchImplementation).get("category"),
            ).toBe("Travel");
        });
        expect(screen.getByText("$742.18")).toBeTruthy();

        const clearCategoryButton = await screen.findByRole("button", {
            name: "Clear category",
        });
        fireEvent.click(clearCategoryButton);

        await waitFor(() => {
            expect(
                screen.getByRole("combobox", { name: "Category" }),
            ).toHaveProperty("value", "");
        });
        expect(screen.getByText("$88.34")).toBeTruthy();
    });

    test("matches typed category casing against canonical options", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                createJsonResponse(
                    createSummaryPage([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ),
        ) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "tRaVeL" },
        });

        await waitFor(() => {
            expect(
                readLastRequestQuery(fetchImplementation).get("category"),
            ).toBe("Travel");
        });
        expect(screen.getByText("$742.18")).toBeTruthy();
    });

    test("does not apply unmatched typed category input", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                createJsonResponse(
                    createSummaryPage([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ),
        ) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "travelling" },
        });

        expect(readLastRequestQuery(fetchImplementation).has("category")).toBe(
            false,
        );
        expect(screen.getByText("Showing 2")).toBeTruthy();
        expect(screen.queryByText("No Expense Reports match")).toBeNull();
        expect(screen.getByText("$742.18")).toBeTruthy();
        expect(screen.getByText("$88.34")).toBeTruthy();
    });

    test("filters Multiple reports by underlying category membership", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                createJsonResponse(
                    createSummaryPage([
                        createSummary({
                            category: "Multiple",
                            categories: ["Meals", "Travel"],
                        }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Mileage",
                            categories: ["Mileage"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ),
        ) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "Travel" },
        });

        await waitFor(() => {
            expect(
                readLastRequestQuery(fetchImplementation).get("category"),
            ).toBe("Travel");
        });
        expect(screen.getByText("Multiple")).toBeTruthy();
        expect(screen.getByText("$742.18")).toBeTruthy();
    });

    test("opens the shared report detail modal when Review is clicked", async () => {
        const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
            if (readRequestPath(input) === "/v1/expense-reports") {
                return Promise.resolve(
                    createJsonResponse(
                        createSummaryPage([
                            {
                                id: reportId,
                                createdAt: "2026-07-20T14:30:00.000Z",
                                employeeId:
                                    "50000000-0000-4000-8000-000000000191",
                                managerId,
                                category: "Multiple",
                                categories: ["Mileage", "Travel"],
                                amount: "754.58",
                                currency: "USD",
                                status: "Manager Approval",
                            },
                        ]),
                    ),
                );
            }

            if (readRequestPath(input).endsWith("/audit-entries")) {
                return Promise.resolve(
                    createJsonResponse([
                        {
                            id: "71000000-0000-4000-8000-000000000191",
                            tenantId,
                            expenseReportId: reportId,
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

            if (readRequestPath(input).endsWith("/comments")) {
                return Promise.resolve(
                    createJsonResponse([
                        {
                            id: "72000000-0000-4000-8000-000000000191",
                            tenantId,
                            expenseReportId: reportId,
                            authorId: userId,
                            body: "Synthetic report comment.",
                            createdAt: "2026-07-22T13:00:00.000Z",
                        },
                    ]),
                );
            }

            return Promise.resolve(
                createJsonResponse({
                    expenseReportId: reportId,
                    owner: "50000000-0000-4000-8000-000000000191",
                    priority: "Normal",
                    dueDate: "2026-07-30",
                    status: "Manager Approval",
                    onHold: false,
                    isOverdue: false,
                    lineItems: [
                        {
                            id: "a7a69670-b8ad-4850-9d55-4c15db31786f",
                            date: "2026-07-20",
                            amount: "742.18",
                            currency: "USD",
                            glCode: "6240",
                            flaggedLineItem: true,
                            reviewAction: null,
                            deductible: false,
                            merchant: "Northstar Hotels",
                            category: "Travel",
                        },
                        {
                            id: "b7a69670-b8ad-4850-9d55-4c15db31786f",
                            date: "2026-07-21",
                            amount: "38.50",
                            currency: "USD",
                            glCode: "6000",
                            flaggedLineItem: false,
                            reviewAction: "approve",
                            deductible: false,
                            merchant: "Metro Rail",
                            category: "Travel",
                        },
                    ],
                    mileageEntries: [
                        {
                            id: "f7b2017a-7d30-4d80-a360-53d00f387111",
                            date: "2026-07-20",
                            amount: "12.40",
                            currency: "USD",
                            glCode: "6250",
                            flaggedLineItem: false,
                            reviewAction: null,
                            deductible: false,
                            route: "Office to client site",
                            distance: "18.50",
                        },
                    ],
                }),
            );
        }) as typeof fetch;
        renderExpenseReportsScreen(fetchImplementation);

        fireEvent.click(await screen.findByRole("button", { name: "Review" }));

        const dialog = await screen.findByRole("dialog", {
            name: `Expense Report ${reportId.slice(0, 8).toUpperCase()}`,
        });
        expect(
            await within(dialog).findByRole("list", {
                name: "Expense Report stage progress",
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("complementary", {
                name: "Expense Report case summary",
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Northstar Hotels \$742\.18 - 6240 Over \$500 Not reviewed/i,
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Metro Rail \$38\.50 - 6000 Clear Approved/i,
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Office to client site \$12\.40 18\.50 mi 6250 Clear Not reviewed/i,
            }),
        ).toBeTruthy();

        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Audit Trail" }),
        );
        expect(
            await within(dialog).findByText("Transition Approved"),
        ).toBeTruthy();

        fireEvent.click(within(dialog).getByRole("tab", { name: "Comments" }));
        expect(
            await within(dialog).findByText("Synthetic report comment."),
        ).toBeTruthy();
    });
});

function createSummary(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: reportId,
        createdAt: "2026-07-20T14:30:00.000Z",
        employeeId: "50000000-0000-4000-8000-000000000191",
        managerId: null,
        category: "Travel",
        categories: ["Travel"],
        amount: "742.18",
        currency: "USD",
        status: "Manager Approval",
        ...overrides,
    };
}

function readRequestPath(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return new URL(input, "http://localhost").pathname;
    }

    if (input instanceof URL) {
        return input.pathname;
    }

    return new URL(input.url, "http://localhost").pathname;
}

function readLastRequestQuery(
    fetchImplementation: typeof fetch,
): URLSearchParams {
    const mock = vi.mocked(fetchImplementation);
    const lastCall = mock.mock.calls.at(-1);
    if (lastCall === undefined) {
        throw new Error("Expected fetch to be called.");
    }

    const input = lastCall[0];
    const url =
        typeof input === "string"
            ? new URL(input, "http://localhost")
            : input instanceof URL
              ? input
              : new URL(input.url, "http://localhost");

    return url.searchParams;
}
