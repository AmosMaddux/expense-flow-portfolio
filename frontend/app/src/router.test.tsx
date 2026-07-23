import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient } from "./auth";
import type { AuthSession, Role } from "./auth";
import { ExpenseFlowRouter } from "./router";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

function createSession(role: Role): AuthSession {
    return {
        tenantId,
        userId,
        roles: [role],
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

function RoutedApp({ authClient }: { authClient: AuthClient }): JSX.Element {
    return (
        <AuthProvider authClient={authClient} now={() => baseTime}>
            <ExpenseFlowRouter />
        </AuthProvider>
    );
}

beforeEach(() => {
    window.scrollTo = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.pushState(null, "", "/");
});

describe("ExpenseFlowRouter", () => {
    test("redirects unauthenticated users from protected routes to login", async () => {
        window.history.pushState(null, "", "/finance-dashboard");
        render(
            <RoutedApp authClient={createAuthClientMock("Finance Admin")} />,
        );

        await screen.findByText("Login route");
        expect(window.location.pathname).toBe("/login");
    });

    test("creates the login route without building a local sign-in page", async () => {
        window.history.pushState(null, "", "/login");
        render(
            <RoutedApp authClient={createAuthClientMock("Finance Admin")} />,
        );

        await screen.findByText("Login route");
        expect(screen.queryByLabelText("Tenant ID")).toBeNull();
        expect(screen.queryByLabelText("Email")).toBeNull();
    });

    test.each([
        ["Finance Admin", "/finance-dashboard", "Finance Dashboard"],
        ["Department Manager", "/finance-dashboard", "Finance Dashboard"],
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

            await screen.findByRole("heading", { name: expectedHeading });
            await waitFor(() =>
                expect(window.location.pathname).toBe(expectedPath),
            );
        },
    );

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
});
