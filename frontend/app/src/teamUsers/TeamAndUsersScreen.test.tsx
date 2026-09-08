import { QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    AuthProvider,
    type AuthClient,
    type AuthSession,
    type Role,
} from "../auth";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { TeamAndUsersScreen } from "./TeamAndUsersScreen";

const usersResponse = {
    users: [
        {
            id: "00000000-0000-4000-8000-000000000801",
            email: "employee@example1.invalid",
            displayName: "Alex Employee",
            status: "active",
            roles: ["Employee"],
            createdAt: "2026-08-03T12:00:00.000Z",
        },
        {
            id: "00000000-0000-4000-8000-000000000802",
            email: "manager@example1.invalid",
            displayName: "Morgan Manager",
            status: "active",
            roles: ["Department Manager"],
            createdAt: "2026-08-03T12:00:00.000Z",
        },
    ],
};

afterEach(() => {
    cleanup();
});

describe("TeamAndUsersScreen", () => {
    test("lists tenant users with role and status", async () => {
        const fetchImplementation = createFetchMock();

        renderTeamAndUsersScreen("Finance Admin", fetchImplementation);

        expect(await screen.findByText("Alex Employee")).toBeTruthy();
        expect(screen.getByText("Morgan Manager")).toBeTruthy();
        expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    });

    test("invites a user and assigns a role", async () => {
        const fetchImplementation = createFetchMock();

        renderTeamAndUsersScreen("Finance Admin", fetchImplementation);
        await screen.findByText("Alex Employee");

        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "new-hire@example1.invalid" },
        });
        fireEvent.change(screen.getByLabelText("Name"), {
            target: { value: "New Hire" },
        });
        fireEvent.change(screen.getByLabelText("Role"), {
            target: { value: "Department Manager" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Invite" }));

        await waitFor(() => {
            expect(
                fetchImplementation.mock.calls.some(
                    ([input, init]) =>
                        requestPath(input) === "/v1/users/invite" &&
                        init?.method === "POST",
                ),
            ).toBe(true);
        });
        const inviteCall = fetchImplementation.mock.calls.find(
            ([input]) => requestPath(input) === "/v1/users/invite",
        );

        expect(inviteCall?.[1]?.body).toBe(
            JSON.stringify({
                email: "new-hire@example1.invalid",
                displayName: "New Hire",
                role: "Department Manager",
            }),
        );
    });

    test("filters the list down by search term", async () => {
        const fetchImplementation = createFetchMock();

        renderTeamAndUsersScreen("Finance Admin", fetchImplementation);
        await screen.findByText("Alex Employee");
        expect(screen.getByText("Morgan Manager")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Search"), {
            target: { value: "alex" },
        });

        expect(screen.getByText("Alex Employee")).toBeTruthy();
        expect(screen.queryByText("Morgan Manager")).toBeNull();
    });

    test("filters the list down by role", async () => {
        const fetchImplementation = createFetchMock();

        renderTeamAndUsersScreen("Finance Admin", fetchImplementation);
        await screen.findByText("Alex Employee");

        fireEvent.change(screen.getByLabelText("Filter by role"), {
            target: { value: "Department Manager" },
        });

        expect(screen.getByText("Morgan Manager")).toBeTruthy();
        expect(screen.queryByText("Alex Employee")).toBeNull();
    });
});

function renderTeamAndUsersScreen(
    role: Role,
    fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>,
): void {
    const queryClient = createExpenseFlowQueryClient();

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClient(role)}
                fetchImplementation={fetchImplementation}
                now={() => Date.parse("2026-08-03T12:00:00.000Z")}
            >
                <TeamAndUsersScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

function createAuthClient(role: Role): AuthClient {
    const session = createSession(role);

    return {
        login: vi.fn(() => Promise.resolve(session)),
        refresh: vi.fn(() => Promise.resolve(session)),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function createSession(role: Role): AuthSession {
    return {
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: "2026-08-03T12:15:00.000Z",
        tenantId: "00000000-0000-4000-8000-000000000701",
        userId: "00000000-0000-4000-8000-000000000702",
        roles: [role],
    };
}

function createFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>((input, init) => {
        const path = requestPath(input);
        if (path === "/v1/users" && init?.method === undefined) {
            return Promise.resolve(jsonResponse(usersResponse));
        }

        if (path === "/v1/users/invite" && init?.method === "POST") {
            return Promise.resolve(
                jsonResponse(
                    {
                        id: "00000000-0000-4000-8000-000000000803",
                        email: "new-hire@example1.invalid",
                        displayName: "New Hire",
                        status: "invited",
                        roles: ["Department Manager"],
                        createdAt: "2026-08-03T12:00:00.000Z",
                    },
                    201,
                ),
            );
        }

        return Promise.resolve(
            jsonResponse(
                {
                    detail: "Unexpected request.",
                },
                404,
            ),
        );
    });
}

function requestPath(input: Parameters<typeof fetch>[0]): string {
    const url =
        typeof input === "string"
            ? new URL(input, "http://test")
            : input instanceof URL
              ? input
              : new URL(input.url);
    return `${url.pathname}${url.search}`;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
