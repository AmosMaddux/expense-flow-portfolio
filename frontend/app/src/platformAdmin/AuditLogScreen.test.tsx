import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    AuthProvider,
    type AuthClient,
    type AuthSession,
    type Role,
} from "../auth";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { AuditLogScreen } from "./AuditLogScreen";

const auditLogResponse = {
    events: [
        {
            id: "00000000-0000-4000-8000-000000000701",
            tenantId: "00000000-0000-4000-8000-000000000601",
            actor: {
                id: "00000000-0000-4000-8000-000000000501",
                email: "admin@example.invalid",
                displayName: "Priya Admin",
            },
            entityType: "user",
            entityId: "00000000-0000-4000-8000-000000000401",
            action: "user_invited",
            occurredAt: "2026-08-20T09:15:00.000Z",
        },
        {
            id: "00000000-0000-4000-8000-000000000702",
            tenantId: "00000000-0000-4000-8000-000000000602",
            actor: {
                id: "00000000-0000-4000-8000-000000000502",
                email: null,
                displayName: null,
            },
            entityType: "gl_mapping",
            entityId: "00000000-0000-4000-8000-000000000402",
            action: "gl_mapping_updated",
            occurredAt: "2026-08-21T14:05:00.000Z",
        },
    ],
};

afterEach(() => {
    cleanup();
});

describe("AuditLogScreen", () => {
    test("lists audit events with actor, action, and timestamp, without editing controls", async () => {
        const fetchImplementation = createFetchMock();

        renderAuditLogScreen(fetchImplementation);

        expect(await screen.findByText("Priya Admin")).toBeTruthy();
        expect(screen.getByText("User invited")).toBeTruthy();
        expect(screen.getByText("GL mapping updated")).toBeTruthy();
        expect(
            screen.getByText("00000000-0000-4000-8000-000000000502"),
        ).toBeTruthy();
        expect(screen.queryAllByRole("button").length).toBe(0);
        expect(screen.queryAllByRole("link").length).toBe(0);
        expect(
            screen.queryByText(/receipt|expense report|amount/i),
        ).toBeNull();
    });

    test("shows an error state when audit events cannot be loaded", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(jsonResponse({ detail: "Not permitted." }, 403)),
        );

        renderAuditLogScreen(fetchImplementation);

        expect(
            await screen.findByText("Unable to load Audit Log"),
        ).toBeTruthy();
    });

    test("has no axe violations once events are loaded", async () => {
        const fetchImplementation = createFetchMock();

        renderAuditLogScreen(fetchImplementation);

        await screen.findByText("Priya Admin");

        const axeResults = await axe.run(
            screen.getByRole("region", { name: "Audit Log" }),
        );
        expect(axeResults.violations).toHaveLength(0);
    });
});

function renderAuditLogScreen(
    fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>,
): void {
    const queryClient = createExpenseFlowQueryClient();

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClient("Admin")}
                fetchImplementation={fetchImplementation}
                now={() => Date.parse("2026-08-27T12:00:00.000Z")}
            >
                <AuditLogScreen />
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
        accessTokenExpiresAt: "2026-08-27T12:15:00.000Z",
        tenantId: "00000000-0000-4000-8000-000000000901",
        userId: "00000000-0000-4000-8000-000000000902",
        roles: [role],
    };
}

function createFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>((input) => {
        if (
            resolveRequestUrl(input).endsWith("/v1/platform-admin/audit-log")
        ) {
            return Promise.resolve(jsonResponse(auditLogResponse));
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
