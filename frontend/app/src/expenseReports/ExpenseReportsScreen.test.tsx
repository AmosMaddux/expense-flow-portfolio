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
                    createJsonResponse([
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
                    ]),
                ),
            ) as typeof fetch,
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
            name: /Travel \$742\.18 Manager Approval/i,
        });
        expect(within(row).getByText("Pending assignment")).toBeTruthy();
        expect(
            within(row).getByRole("button", { name: "Review" }),
        ).toBeTruthy();
    });

    test("filters report summaries by date employee category amount and multiple statuses", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse([
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
            ) as typeof fetch,
        );

        expect(await screen.findByText("$742.18")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Date"), {
            target: { value: "2026-07-20" },
        });
        fireEvent.change(screen.getByLabelText("Employee"), {
            target: { value: "50000000" },
        });
        fireEvent.change(screen.getByLabelText("Category"), {
            target: { value: "Travel" },
        });
        fireEvent.change(screen.getByLabelText("Min amount"), {
            target: { value: "500" },
        });
        fireEvent.change(screen.getByLabelText("Max amount"), {
            target: { value: "800" },
        });
        fireEvent.click(screen.getByLabelText("Manager Approval"));
        fireEvent.click(screen.getByLabelText("AP Review"));

        expect(screen.getByText("Showing 1 of 3")).toBeTruthy();
        expect(screen.getByText("$742.18")).toBeTruthy();
        expect(screen.queryByText("$245.10")).toBeNull();
        expect(screen.queryByText("$88.34")).toBeNull();
    });

    test("filters category selector options while typing", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ) as typeof fetch,
        );

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "tra" },
        });

        expect(screen.getByRole("button", { name: "Travel" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Meals" })).toBeNull();
        expect(screen.getByText("Showing 2 of 2")).toBeTruthy();
    });

    test("selects and clears a valid category filter", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ) as typeof fetch,
        );

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "tra" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Travel" }));

        expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
        expect(screen.getByText("$742.18")).toBeTruthy();
        expect(screen.queryByText("$88.34")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Clear category" }));

        expect(screen.getByText("Showing 2 of 2")).toBeTruthy();
        expect(screen.getByText("$88.34")).toBeTruthy();
    });

    test("matches typed category casing against canonical options", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ) as typeof fetch,
        );

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "tRaVeL" },
        });

        expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
        expect(screen.getByText("$742.18")).toBeTruthy();
        expect(screen.queryByText("$88.34")).toBeNull();
    });

    test("does not apply unmatched typed category input", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse([
                        createSummary({ category: "Travel" }),
                        createSummary({
                            id: "60000000-0000-4000-8000-000000000192",
                            category: "Meals",
                            categories: ["Meals"],
                            amount: "88.34",
                        }),
                    ]),
                ),
            ) as typeof fetch,
        );

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "travelling" },
        });

        expect(screen.getByText("Showing 2 of 2")).toBeTruthy();
        expect(screen.queryByText("No Expense Reports match")).toBeNull();
        expect(screen.getByText("$742.18")).toBeTruthy();
        expect(screen.getByText("$88.34")).toBeTruthy();
    });

    test("filters Multiple reports by underlying category membership", async () => {
        renderExpenseReportsScreen(
            vi.fn(() =>
                Promise.resolve(
                    createJsonResponse([
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
            ) as typeof fetch,
        );

        await screen.findByText("$742.18");

        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
            target: { value: "Travel" },
        });

        expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
        expect(screen.getByText("Multiple")).toBeTruthy();
        expect(screen.getByText("$742.18")).toBeTruthy();
        expect(screen.queryByText("$88.34")).toBeNull();
    });

    test("opens the shared report detail modal when Review is clicked", async () => {
        const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
            if (readRequestPath(input) === "/v1/expense-reports") {
                return Promise.resolve(
                    createJsonResponse([
                        {
                            id: reportId,
                            createdAt: "2026-07-20T14:30:00.000Z",
                            employeeId: "50000000-0000-4000-8000-000000000191",
                            managerId: null,
                            category: "Multiple",
                            categories: ["Mileage", "Travel"],
                            amount: "754.58",
                            currency: "USD",
                            status: "Manager Approval",
                        },
                    ]),
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
                name: /Office to client site \$12\.40 18\.50 mi 6250 Clear Not reviewed/i,
            }),
        );

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
