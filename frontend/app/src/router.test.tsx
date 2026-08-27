import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient } from "./auth";
import type { AuthSession, Role } from "./auth";
import { ExpenseFlowRouter } from "./router";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

function createSession(role: Role, roles: Role[] = [role]): AuthSession {
    return {
        tenantId,
        userId,
        roles,
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
    };
}

function createAuthClientMock(loginRole: Role): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(createSession(loginRole))),
        refresh: vi.fn(() =>
            Promise.reject(new Error("No synthetic refresh cookie.")),
        ),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function RoutedApp({
    authClient,
    fetchImplementation = vi.fn<typeof fetch>(() =>
        Promise.resolve(
            new Response(
                JSON.stringify([
                    {
                        currentStage: "Submitted",
                        overdueCount: 0,
                        reportCount: 1,
                    },
                ]),
                {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                },
            ),
        ),
    ),
}: {
    authClient: AuthClient;
    fetchImplementation?: typeof fetch;
}): JSX.Element {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });

    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={authClient}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <ExpenseFlowRouter />
            </AuthProvider>
        </QueryClientProvider>
    );
}

async function submitSignIn(): Promise<void> {
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "employee@example1.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "synthetic-password" },
    });
    fireEvent.submit(
        screen.getByRole("button", { name: /sign in/i }).closest("form")!,
    );
}

beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.stubEnv("VITE_TENANT_ID", tenantId);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.history.pushState(null, "", "/");
});

describe("ExpenseFlowRouter", () => {
    test("redirects unauthenticated users from protected routes to login", async () => {
        window.history.pushState(null, "", "/finance-dashboard");
        render(
            <RoutedApp authClient={createAuthClientMock("Finance Admin")} />,
        );

        await screen.findByRole("heading", { name: "Welcome back" });
        expect(window.location.pathname).toBe("/login");
        expect(
            new URLSearchParams(window.location.search).get("redirect"),
        ).toBe("/finance-dashboard");
    });

    test("mounts the existing auth sign-in screen at the login route", async () => {
        window.history.pushState(null, "", "/login");
        render(
            <RoutedApp authClient={createAuthClientMock("Finance Admin")} />,
        );

        await screen.findByRole("heading", { name: "Welcome back" });
        expect(screen.getByLabelText("Email")).not.toBeNull();
        expect(screen.getByLabelText("Password")).not.toBeNull();
        expect(screen.queryByLabelText("Tenant ID")).toBeNull();
    });

    test("signs in from the login route and lands on the role dashboard", async () => {
        const authClient = createAuthClientMock("Employee");
        window.history.pushState(null, "", "/login");
        render(<RoutedApp authClient={authClient} />);

        await submitSignIn();

        await screen.findByRole("heading", { name: "My Submissions" });
        await waitFor(() =>
            expect(window.location.pathname).toBe("/my-submissions"),
        );
        expect(authClient.login).toHaveBeenCalledWith({
            tenantId,
            email: "employee@example1.invalid",
            password: "synthetic-password",
        });
    });

    test("returns Employees to an allowed protected deep link after sign-in", async () => {
        const authClient = createAuthClientMock("Employee");
        window.history.pushState(null, "", "/submit-expense");
        render(<RoutedApp authClient={authClient} />);

        await submitSignIn();

        await screen.findByRole("heading", { name: "Submit Expense" });
        await waitFor(() =>
            expect(window.location.pathname).toBe("/submit-expense"),
        );
    });

    test("returns an Employee to Log Mileage after direct-link sign-in", async () => {
        const authClient = createAuthClientMock("Employee");
        const fetchImplementation = vi.fn<typeof fetch>((input) => {
            if (input === "/v1/expense-reports/drafts/current") {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            detail: "No Drafted Expense Report was found.",
                        }),
                        {
                            headers: {
                                "Content-Type": "application/problem+json",
                            },
                            status: 404,
                        },
                    ),
                );
            }

            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        ratePerMile: 0.7,
                        currency: "USD",
                    }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                ),
            );
        });
        window.history.pushState(null, "", "/log-mileage");
        render(
            <RoutedApp
                authClient={authClient}
                fetchImplementation={fetchImplementation}
            />,
        );

        await submitSignIn();

        await screen.findByText("No draft report available");
        expect(window.location.pathname).toBe("/log-mileage");
    });

    test.each([
        "/finance-dashboard",
        "https://synthetic.invalid/redirect",
        "//synthetic.invalid/redirect",
    ])(
        "ignores an unauthorized or external post-login redirect: %s",
        async (redirect) => {
            const authClient = createAuthClientMock("Employee");
            window.history.pushState(
                null,
                "",
                `/login?redirect=${encodeURIComponent(redirect)}`,
            );
            render(<RoutedApp authClient={authClient} />);

            await submitSignIn();

            await screen.findByRole("heading", { name: "My Submissions" });
            await waitFor(() =>
                expect(window.location.pathname).toBe("/my-submissions"),
            );
        },
    );

    test.each([
        ["Finance Admin", "/finance-dashboard", "Finance Dashboard"],
        ["Department Manager", "/approval-queue", "Approval Queue"],
        ["Employee", "/my-submissions", "My Submissions"],
        ["Admin", "/roles-permissions", "Roles & Permissions"],
    ] as const)(
        "lands %s users on their dashboard after authentication",
        async (role, expectedPath, expectedHeading) => {
            const authClient = createAuthClientMock(role);
            vi.mocked(authClient.refresh).mockResolvedValue(
                createSession(role),
            );
            window.history.pushState(null, "", "/login");
            render(<RoutedApp authClient={authClient} />);

            expect(
                await screen.findAllByRole("heading", {
                    name: expectedHeading,
                }),
            ).not.toHaveLength(0);
            await waitFor(() =>
                expect(window.location.pathname).toBe(expectedPath),
            );
        },
    );

    test("allows any assigned role to access matching routes and navigation", async () => {
        const authClient = createAuthClientMock("Finance Admin");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Finance Admin", ["Finance Admin", "Employee"]),
        );
        window.history.pushState(null, "", "/my-submissions");
        render(<RoutedApp authClient={authClient} />);

        await screen.findByRole("heading", { name: "My Submissions" });
        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });
        expect(
            within(sidebar).getByRole("link", { name: "Finance Dashboard" }),
        ).not.toBeNull();
        expect(
            within(sidebar).getByRole("link", { name: "Submit Expense" }),
        ).not.toBeNull();
        expect(window.location.pathname).toBe("/my-submissions");
    });

    test("marks the routed workspace path as the active navigation item", async () => {
        const authClient = createAuthClientMock("Department Manager");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Department Manager"),
        );
        window.history.pushState(null, "", "/approval-queue");
        render(<RoutedApp authClient={authClient} />);

        await screen.findByRole("heading", { name: "Approval Queue" });
        expect(screen.getAllByText("Approval Queue").length).toBeGreaterThan(1);
        expect(
            screen.queryByText(/This protected workspace route is available/),
        ).toBeNull();
        expect(
            screen
                .getByRole("link", { name: "Approval Queue" })
                .getAttribute("aria-current"),
        ).toBe("page");
        expect(
            screen.queryByRole("link", { name: "Finance Dashboard" }),
        ).toBeNull();
    });

    test("mounts the expense reports browser for finance admins", async () => {
        const authClient = createAuthClientMock("Finance Admin");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Finance Admin"),
        );
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response(JSON.stringify([]), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                }),
            ),
        );
        window.history.pushState(null, "", "/expense-reports");
        render(
            <RoutedApp
                authClient={authClient}
                fetchImplementation={fetchImplementation}
            />,
        );

        expect(
            await screen.findAllByRole("heading", { name: "Expense Reports" }),
        ).not.toHaveLength(0);
        expect(
            screen.queryByText(/This protected workspace route is available/),
        ).toBeNull();
        expect(fetchImplementation).toHaveBeenCalledWith(
            "/v1/expense-reports",
            expect.anything(),
        );
        expect(
            screen
                .getByRole("link", { name: "Expense Reports" })
                .getAttribute("aria-current"),
        ).toBe("page");
    });

    test("renders sign out in the routed workspace and clears the session", async () => {
        const authClient = createAuthClientMock("Finance Admin");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Finance Admin"),
        );
        window.history.pushState(null, "", "/finance-dashboard");
        render(<RoutedApp authClient={authClient} />);

        await screen.findByRole("heading", { name: "Finance Dashboard" });
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        await screen.findByRole("heading", { name: "Welcome back" });
        expect(authClient.logout).toHaveBeenCalledOnce();
        expect(window.location.pathname).toBe("/login");
        expect(window.location.search).toBe("");
    });
    test("redirects authenticated users away from routes their role cannot access", async () => {
        const authClient = createAuthClientMock("Employee");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Employee"),
        );
        window.history.pushState(null, "", "/finance-dashboard");
        render(<RoutedApp authClient={authClient} />);

        await screen.findByRole("heading", { name: "My Submissions" });
        await waitFor(() =>
            expect(window.location.pathname).toBe("/my-submissions"),
        );
    });

    test("redirects Department Manager users away from the Finance Dashboard route", async () => {
        const authClient = createAuthClientMock("Department Manager");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Department Manager"),
        );
        window.history.pushState(null, "", "/finance-dashboard");
        render(<RoutedApp authClient={authClient} />);

        await screen.findByRole("heading", { name: "Approval Queue" });
        await waitFor(() =>
            expect(window.location.pathname).toBe("/approval-queue"),
        );
    });
    test("scopes the Finance Admin approval queue to Manager Approval and AP Review stages", async () => {
        const authClient = createAuthClientMock("Finance Admin");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Finance Admin"),
        );
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            id: "a7a69670-b8ad-4850-9d55-4c15db31786f",
                            sourceType: "line_item",
                            expenseReportId:
                                "d104c9ca-9de7-4f85-bb23-ed907e9db001",
                            employee: "50000000-0000-4000-8000-000000000191",
                            merchant: "Northstar Hotels",
                            amount: 742.18,
                            glCode: "6240",
                            currentStage: "Manager Approval",
                            flaggedLineItem: false,
                            policyChecks: [],
                            reviewAction: null,
                            deductible: false,
                            canAdvance: false,
                            reportTotalMileage: 0,
                            receipts: [],
                            mileageEntries: [],
                        },
                        {
                            id: "b21bf320-a041-4ec6-8550-3c2315cc0c68",
                            sourceType: "line_item",
                            expenseReportId:
                                "d104c9ca-9de7-4f85-bb23-ed907e9db002",
                            employee: "50000000-0000-4000-8000-000000000192",
                            merchant: "Metro Meals",
                            amount: 86.42,
                            glCode: "6210",
                            currentStage: "Submitted",
                            flaggedLineItem: false,
                            policyChecks: [],
                            reviewAction: null,
                            deductible: false,
                            canAdvance: false,
                            reportTotalMileage: 0,
                            receipts: [],
                            mileageEntries: [],
                        },
                        {
                            id: "e6f4d30b-20fc-4a72-9e44-190eb7d30c72",
                            sourceType: "line_item",
                            expenseReportId:
                                "d104c9ca-9de7-4f85-bb23-ed907e9db003",
                            employee: "50000000-0000-4000-8000-000000000193",
                            merchant: "Zenith Air",
                            amount: 512,
                            glCode: "6220",
                            currentStage: "AP Review",
                            flaggedLineItem: false,
                            policyChecks: [],
                            reviewAction: null,
                            deductible: false,
                            canAdvance: false,
                            reportTotalMileage: 0,
                            receipts: [],
                            mileageEntries: [],
                        },
                    ]),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                ),
            ),
        );
        window.history.pushState(null, "", "/approval-queue");
        render(
            <RoutedApp
                authClient={authClient}
                fetchImplementation={fetchImplementation}
            />,
        );

        await screen.findByText("Employee 0191");
        expect(screen.getByText("Employee 0193")).toBeTruthy();
        expect(screen.queryByText("Employee 0192")).toBeNull();
    });

    test("redirects Employee users away from the internal Case Queue route", async () => {
        const authClient = createAuthClientMock("Employee");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Employee"),
        );
        window.history.pushState(null, "", "/approval-queue");
        render(<RoutedApp authClient={authClient} />);

        await screen.findByRole("heading", { name: "My Submissions" });
        await waitFor(() =>
            expect(window.location.pathname).toBe("/my-submissions"),
        );
        expect(
            screen.queryByRole("heading", { name: "Approval Queue" }),
        ).toBeNull();
    });

    test("keeps the Employee session when navigating from mileage to Submit Expense", async () => {
        const authClient = createAuthClientMock("Employee");
        vi.mocked(authClient.refresh).mockResolvedValue(
            createSession("Employee"),
        );
        const fetchImplementation = vi.fn<typeof fetch>((input) => {
            if (input === "/v1/expense-reports/drafts/current") {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            detail: "No Drafted Expense Report was found.",
                        }),
                        {
                            headers: {
                                "Content-Type": "application/problem+json",
                            },
                            status: 404,
                        },
                    ),
                );
            }

            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        ratePerMile: 0.7,
                        currency: "USD",
                    }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                ),
            );
        });
        window.history.pushState(null, "", "/log-mileage");
        render(
            <RoutedApp
                authClient={authClient}
                fetchImplementation={fetchImplementation}
            />,
        );

        fireEvent.click(
            await screen.findByRole("link", {
                name: "Create a draft report",
            }),
        );

        await waitFor(() =>
            expect(window.location.pathname).toBe("/submit-expense"),
        );
        expect(
            await screen.findByRole("heading", { name: "Submit Expense" }),
        ).toBeTruthy();
        expect(
            screen.queryByRole("heading", { name: "Welcome back" }),
        ).toBeNull();
    });
});
