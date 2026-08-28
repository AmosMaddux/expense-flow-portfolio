import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    AuthProvider,
    type AuthClient,
    type AuthSession,
    type Role,
} from "../auth";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { AllTenantsScreen } from "./AllTenantsScreen";

const tenantsResponse = {
    tenants: [
        {
            tenantId: "00000000-0000-4000-8000-000000000701",
            userCount: 3,
            activeUserCount: 2,
            invitedUserCount: 1,
            deactivatedUserCount: 0,
        },
        {
            tenantId: "00000000-0000-4000-8000-000000000702",
            userCount: 1,
            activeUserCount: 0,
            invitedUserCount: 0,
            deactivatedUserCount: 1,
        },
    ],
};

afterEach(() => {
    cleanup();
});

describe("AllTenantsScreen", () => {
    test("lists tenants with their user counts, without impersonation controls", async () => {
        const fetchImplementation = createFetchMock();

        renderAllTenantsScreen(fetchImplementation);

        expect(
            await screen.findByText(
                "00000000-0000-4000-8000-000000000701",
            ),
        ).toBeTruthy();
        expect(
            screen.getByText("00000000-0000-4000-8000-000000000702"),
        ).toBeTruthy();
        expect(screen.getByText("3")).toBeTruthy();
        expect(screen.queryAllByRole("button").length).toBe(0);
        expect(screen.queryAllByRole("link").length).toBe(0);
    });

    test("shows an error state when tenant summaries cannot be loaded", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                jsonResponse({ detail: "Not permitted." }, 403),
            ),
        );

        renderAllTenantsScreen(fetchImplementation);

        expect(
            await screen.findByText("Unable to load All Tenants & Users"),
        ).toBeTruthy();
    });
});

function renderAllTenantsScreen(
    fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>,
): void {
    const queryClient = createExpenseFlowQueryClient();

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClient("Admin")}
                fetchImplementation={fetchImplementation}
                now={() => Date.parse("2026-08-03T12:00:00.000Z")}
            >
                <AllTenantsScreen />
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
        tenantId: "00000000-0000-4000-8000-000000000901",
        userId: "00000000-0000-4000-8000-000000000902",
        roles: [role],
    };
}

function createFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>((input) => {
        if (resolveRequestUrl(input).endsWith("/v1/platform-admin/tenants")) {
            return Promise.resolve(jsonResponse(tenantsResponse));
        }

        return Promise.resolve(
            jsonResponse({ detail: "Unexpected request." }, 404),
        );
    });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return input;
    }

    if (input instanceof URL) {
        return input.toString();
    }

    return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
