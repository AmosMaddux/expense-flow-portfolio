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

    test("opens the report review detail when Review is clicked", async () => {
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
                            amount: "754.58",
                            currency: "USD",
                            status: "Manager Approval",
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
            name: `Report ${reportId.slice(0, 8).toUpperCase()}`,
        });
        await waitFor(() =>
            expect(within(dialog).getByText("Northstar Hotels")).toBeTruthy(),
        );
        expect(within(dialog).getByText("Office to client site")).toBeTruthy();
        expect(within(dialog).getByText("$754.58")).toBeTruthy();
    });
});

function readRequestPath(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return new URL(input, "http://localhost").pathname;
    }

    if (input instanceof URL) {
        return input.pathname;
    }

    return new URL(input.url, "http://localhost").pathname;
}
