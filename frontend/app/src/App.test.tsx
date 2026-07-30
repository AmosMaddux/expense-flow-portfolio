import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import App, { AppShell, getRoleLandingScreen } from "./App";
import {
    AuthProvider,
    AuthRequestError,
    type AuthClient,
    type AuthSession,
    type Role,
} from "./auth";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";

function createSession(role: Role = "Finance Admin"): AuthSession {
    return {
        tenantId,
        userId,
        roles: [role],
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
}

function createAuthClientMock(role: Role = "Finance Admin"): AuthClient {
    return {
        login: vi
            .fn()
            .mockRejectedValueOnce(
                new AuthRequestError(
                    401,
                    "MFA code is required.",
                    "MFA_REQUIRED",
                ),
            )
            .mockResolvedValueOnce(createSession(role)),
        refresh: vi
            .fn()
            .mockRejectedValue(new Error("No synthetic refresh cookie.")),
        logout: vi.fn().mockResolvedValue(undefined),
    };
}

function renderApp(authClient: AuthClient): void {
    render(
        <AuthProvider authClient={authClient}>
            <App tenantId={tenantId} />
        </AuthProvider>,
    );
}

async function completePrimarySignIn(): Promise<void> {
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "employee@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "synthetic-password" },
    });
    fireEvent.submit(
        screen.getByRole("button", { name: /sign in/i }).closest("form")!,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
});

describe("authentication UI", () => {
    test("uses sign-in as the unauthenticated landing view", async () => {
        const authClient = createAuthClientMock();
        renderApp(authClient);

        await screen.findByRole("heading", { name: "Welcome back" });

        expect(screen.getByLabelText("Email").getAttribute("type")).toBe(
            "email",
        );
        expect(screen.getByLabelText("Password").getAttribute("type")).toBe(
            "password",
        );
    });

    test("submits primary credentials, completes MFA, routes by role, and logs out", async () => {
        const authClient = createAuthClientMock("Employee");
        window.history.replaceState(null, "", "/stale-route");
        renderApp(authClient);

        await completePrimarySignIn();
        await screen.findByRole("heading", { name: "Verify your identity" });

        expect(authClient.login).toHaveBeenNthCalledWith(1, {
            tenantId,
            email: "employee@example.invalid",
            password: "synthetic-password",
        });

        for (const [index, digit] of ["1", "2", "3", "4", "5", "6"].entries()) {
            fireEvent.change(screen.getByLabelText(`Digit ${index + 1}`), {
                target: { value: digit },
            });
        }
        fireEvent.submit(
            screen.getByRole("button", { name: "Verify" }).closest("form")!,
        );

        await screen.findByRole("heading", {
            level: 1,
            name: "Employee Portal",
        });
        expect(window.location.pathname).toBe("/my-submissions");
        expect(authClient.login).toHaveBeenNthCalledWith(2, {
            tenantId,
            email: "employee@example.invalid",
            password: "synthetic-password",
            totpCode: "123456",
        });

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
        await screen.findByRole("heading", { name: "Welcome back" });
        expect(window.location.pathname).toBe("/");
        expect(authClient.logout).toHaveBeenCalledOnce();
    });

    test("shows a retry-safe error when the MFA code is rejected", async () => {
        const authClient = createAuthClientMock();
        vi.mocked(authClient.login)
            .mockReset()
            .mockRejectedValueOnce(
                new AuthRequestError(
                    401,
                    "MFA code is required.",
                    "MFA_REQUIRED",
                ),
            )
            .mockRejectedValue(
                new AuthRequestError(
                    401,
                    "Invalid or expired MFA code.",
                    "INVALID_MFA_CODE",
                ),
            );
        renderApp(authClient);

        await completePrimarySignIn();
        await screen.findByRole("heading", { name: "Verify your identity" });
        for (const [index, digit] of ["6", "5", "4", "3", "2", "1"].entries()) {
            fireEvent.change(screen.getByLabelText(`Digit ${index + 1}`), {
                target: { value: digit },
            });
        }
        fireEvent.submit(
            screen.getByRole("button", { name: "Verify" }).closest("form")!,
        );

        await screen.findByRole("alert");
        expect(screen.getByRole("alert").textContent).toContain(
            "invalid or expired",
        );
    });

    test("distributes a full browser-autofilled MFA code", async () => {
        const authClient = createAuthClientMock("Employee");
        renderApp(authClient);

        await completePrimarySignIn();
        await screen.findByRole("heading", { name: "Verify your identity" });
        fireEvent.change(screen.getByLabelText("Digit 1"), {
            target: { value: "123456" },
        });
        fireEvent.submit(
            screen.getByRole("button", { name: "Verify" }).closest("form")!,
        );

        await screen.findByRole("heading", {
            level: 1,
            name: "Employee Portal",
        });
        expect(authClient.login).toHaveBeenNthCalledWith(2, {
            tenantId,
            email: "employee@example.invalid",
            password: "synthetic-password",
            totpCode: "123456",
        });
    });

    test("distributes a pasted MFA code", async () => {
        const authClient = createAuthClientMock("Employee");
        renderApp(authClient);

        await completePrimarySignIn();
        await screen.findByRole("heading", { name: "Verify your identity" });
        fireEvent.paste(screen.getByLabelText("Digit 1"), {
            clipboardData: {
                getData: () => "654321",
            },
        });
        fireEvent.submit(
            screen.getByRole("button", { name: "Verify" }).closest("form")!,
        );

        await screen.findByRole("heading", {
            level: 1,
            name: "Employee Portal",
        });
        expect(authClient.login).toHaveBeenNthCalledWith(2, {
            tenantId,
            email: "employee@example.invalid",
            password: "synthetic-password",
            totpCode: "654321",
        });
    });

    test("keeps invalid primary credentials on sign-in", async () => {
        const authClient = createAuthClientMock();
        vi.mocked(authClient.login)
            .mockReset()
            .mockRejectedValue(
                new AuthRequestError(
                    401,
                    "Invalid email or password.",
                    "INVALID_CREDENTIALS",
                ),
            );
        renderApp(authClient);

        await completePrimarySignIn();

        await screen.findByRole("alert");
        expect(
            screen.getByRole("heading", { name: "Welcome back" }),
        ).not.toBeNull();
        expect(
            screen.queryByRole("heading", { name: "Verify your identity" }),
        ).toBeNull();
        expect(authClient.login).toHaveBeenCalledOnce();
    });

    test("keeps the mocked password-reset flow UI-only", async () => {
        const authClient = createAuthClientMock();
        renderApp(authClient);

        await screen.findByRole("heading", { name: "Welcome back" });
        fireEvent.click(
            screen.getByRole("button", { name: "Forgot password?" }),
        );
        await screen.findByRole("heading", { name: "Reset your password" });
        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "employee@example.invalid" },
        });
        fireEvent.submit(
            screen.getByRole("button", { name: "Continue" }).closest("form")!,
        );

        await screen.findByRole("heading", { name: "Check your email" });
        expect(authClient.login).not.toHaveBeenCalled();
        expect(authClient.logout).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("button", { name: "Return to sign in" }),
        );
        await screen.findByRole("heading", { name: "Welcome back" });
    });
});

describe("role landing selection", () => {
    test.each([
        ["Finance Admin", "Finance Dashboard"],
        ["Department Manager", "Expense Reports"],
        ["Employee", "Employee Portal"],
        ["Admin", "Administration"],
    ] satisfies Array<[Role, string]>)(
        "routes %s to %s",
        (role, expectedLanding) => {
            expect(getRoleLandingScreen(role)).toBe(expectedLanding);
        },
    );
});

describe("AppShell", () => {
    test("renders Department Manager navigation without Team & Users", () => {
        render(
            <AppShell
                currentPath="/approval-queue"
                signedInRole="Department Manager"
            />,
        );

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });
        const approvalQueueLink = within(sidebar).getByRole("link", {
            name: "Approval Queue",
        });

        expect(within(sidebar).queryByText("Finance Dashboard")).toBeNull();
        expect(within(sidebar).getByText("GL Mapping")).not.toBeNull();
        expect(within(sidebar).queryByText("Team & Users")).toBeNull();
        expect(approvalQueueLink.getAttribute("href")).toBe("/approval-queue");
        expect(approvalQueueLink.getAttribute("aria-current")).toBe("page");
    });

    test("updates browser history and active link without a document refresh", () => {
        window.history.replaceState(null, "", "/my-submissions");
        render(<AppShell signedInRole="Employee" />);

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });
        const submitExpenseLink = within(sidebar).getByRole("link", {
            name: "Submit Expense",
        });

        fireEvent.click(submitExpenseLink);

        expect(window.location.pathname).toBe("/submit-expense");
        expect(submitExpenseLink.getAttribute("href")).toBe("/submit-expense");
        expect(submitExpenseLink.getAttribute("aria-current")).toBe("page");
    });
    test("renders Employee navigation links only for the employee portal", () => {
        render(<AppShell currentPath="/log-mileage" signedInRole="Employee" />);

        const sidebar = screen.getByRole("navigation", {
            name: "Workspace sections",
        });
        const mileageLink = within(sidebar).getByRole("link", {
            name: "Log Mileage",
        });

        expect(within(sidebar).getByText("My Submissions")).not.toBeNull();
        expect(within(sidebar).getByText("Submit Expense")).not.toBeNull();
        expect(within(sidebar).queryByText("Finance Dashboard")).toBeNull();
        expect(mileageLink.getAttribute("href")).toBe("/log-mileage");
        expect(mileageLink.getAttribute("aria-current")).toBe("page");
    });
});
