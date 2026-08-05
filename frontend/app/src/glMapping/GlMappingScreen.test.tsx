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
import { GlMappingScreen } from "./GlMappingScreen";

const mappingResponse = {
    mappings: [
        {
            id: "00000000-0000-4000-8000-000000000801",
            category: "Travel",
            glCodeId: "00000000-0000-4000-8000-000000000901",
            accountCode: "6100",
            accountName: "Travel Expense",
            description: "Synthetic travel account",
            updatedAt: "2026-08-03T12:00:00.000Z",
        },
    ],
    glCodes: [
        {
            id: "00000000-0000-4000-8000-000000000901",
            accountCode: "6100",
            accountName: "Travel Expense",
            description: "Synthetic travel account",
        },
        {
            id: "00000000-0000-4000-8000-000000000902",
            accountCode: "6200",
            accountName: "Meals Expense",
            description: "Synthetic meals account",
        },
    ],
};

afterEach(() => {
    cleanup();
});

describe("GlMappingScreen", () => {
    test("renders Department Manager view as read-only", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Department Manager", fetchImplementation);

        expect(await screen.findByText("Read-only")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
        expect(screen.queryByLabelText("Travel GL account")).toBeNull();
        expect(await screen.findByText(/Travel Expense/)).toBeTruthy();
    });

    test("allows Finance Admins to save a GL Mapping edit", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        const select = await screen.findByLabelText("Travel GL account");
        fireEvent.change(select, {
            target: { value: "00000000-0000-4000-8000-000000000902" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(fetchImplementation).toHaveBeenCalledWith(
                "/v1/gl-mappings/00000000-0000-4000-8000-000000000801",
                expect.objectContaining({ method: "PATCH" }),
            );
        });
        const patchCall = fetchImplementation.mock.calls.find(
            ([input]) =>
                input ===
                "/v1/gl-mappings/00000000-0000-4000-8000-000000000801",
        );
        const patchInit = patchCall?.[1];

        expect(patchInit?.body).toBe(
            JSON.stringify({
                glCodeId: "00000000-0000-4000-8000-000000000902",
            }),
        );
        expect(await screen.findByText("Travel")).toBeTruthy();
    });
});

function renderGlMappingScreen(
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
                <GlMappingScreen />
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
        if (input === "/v1/gl-mappings" && init?.method === undefined) {
            return Promise.resolve(jsonResponse(mappingResponse));
        }

        if (
            input === "/v1/gl-mappings/00000000-0000-4000-8000-000000000801" &&
            init?.method === "PATCH"
        ) {
            return Promise.resolve(
                jsonResponse({
                    ...mappingResponse.mappings[0],
                    glCodeId: "00000000-0000-4000-8000-000000000902",
                    accountCode: "6200",
                    accountName: "Meals Expense",
                    description: "Synthetic meals account",
                }),
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

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
