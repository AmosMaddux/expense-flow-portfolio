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
import { RolesPermissionsScreen } from "./RolesPermissionsScreen";

const matrixResponse = {
    screens: [
        { key: "team-users", label: "Team & Users" },
        { key: "tenants-users", label: "All Tenants & Users" },
    ],
    roles: [
        {
            role: "Finance Admin",
            screens: { "team-users": true, "tenants-users": false },
        },
        {
            role: "Admin",
            screens: { "team-users": false, "tenants-users": true },
        },
    ],
};

afterEach(() => {
    cleanup();
});

describe("RolesPermissionsScreen", () => {
    test("renders the role-to-screen-access matrix read-only", async () => {
        const fetchImplementation = createFetchMock();

        renderRolesPermissionsScreen(fetchImplementation);

        expect(await screen.findByText("Team & Users")).toBeTruthy();
        expect(screen.getByText("All Tenants & Users")).toBeTruthy();
        expect(screen.getAllByText("Allowed").length).toBeGreaterThan(0);
        expect(screen.getAllByText("No access").length).toBeGreaterThan(0);
        expect(screen.queryAllByRole("button").length).toBe(0);
        expect(screen.queryAllByRole("checkbox").length).toBe(0);
    });

    test("shows an error state when the matrix cannot be loaded", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                jsonResponse({ detail: "Not permitted." }, 403),
            ),
        );

        renderRolesPermissionsScreen(fetchImplementation);

        expect(
            await screen.findByText("Unable to load Roles & Permissions"),
        ).toBeTruthy();
    });
});

function renderRolesPermissionsScreen(
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
                <RolesPermissionsScreen />
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
        if (
            resolveRequestUrl(input).endsWith(
                "/v1/platform-admin/roles-permissions",
            )
        ) {
            return Promise.resolve(jsonResponse(matrixResponse));
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
