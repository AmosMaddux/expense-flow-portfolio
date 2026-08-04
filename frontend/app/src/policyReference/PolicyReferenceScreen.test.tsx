import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";

import { PolicyReferenceScreen } from "./PolicyReferenceScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-24T12:00:00.000Z");

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Department Manager"],
        accessToken: "synthetic-policy-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
        ...overrides,
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

function renderPolicyReferenceScreen(
    fetchImplementation: typeof fetch,
): ReturnType<typeof render> {
    const queryClient = createNoRetryQueryClient();

    return render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock()}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <PolicyReferenceScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("PolicyReferenceScreen", () => {
    test("renders tenant expense policy text as read-only content", async () => {
        const policyText =
            "  Synthetic Expense Policy\n\n    Receipts are required for reimbursable lodging.\n";
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse({
                    policyText,
                    updatedAt: "2026-07-24T12:00:00.000Z",
                }),
            ),
        );

        const { container } = renderPolicyReferenceScreen(fetchImplementation);

        expect(
            screen.getByRole("status", { name: "Loading Policy Reference" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("heading", { name: "Policy Reference" }),
        ).toBeTruthy();
        expect(await screen.findByText(/Receipts are required/u)).toBeTruthy();
        expect(
            container.querySelector(".policy-reference__text")?.textContent,
        ).toBe(policyText);
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
    });

    test("sends only the authenticated bearer token for tenant-scoped policy reads", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse({
                    policyText: "Synthetic tenant policy.",
                    updatedAt: "2026-07-24T12:00:00.000Z",
                }),
            ),
        );

        renderPolicyReferenceScreen(fetchImplementation);

        await screen.findByText("Synthetic tenant policy.");

        expect(fetchImplementation).toHaveBeenCalledOnce();
        const [input, init] = fetchImplementation.mock.calls[0] ?? [];
        const headers = new Headers(init?.headers);

        expect(input).toBe("/v1/policy-reference");
        expect(headers.get("Authorization")).toBe(
            "Bearer synthetic-policy-access-token",
        );
        expect(init?.body).toBeUndefined();
    });

    test("shows retryable error state when policy loading fails", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                createJsonResponse(
                    {
                        detail: "Synthetic policy failure.",
                        status: 500,
                        title: "Internal Server Error",
                    },
                    {
                        headers: {
                            "Content-Type": "application/problem+json",
                        },
                        status: 500,
                    },
                ),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    policyText: "Synthetic retry policy.",
                    updatedAt: "2026-07-24T12:00:00.000Z",
                }),
            );

        renderPolicyReferenceScreen(fetchImplementation);

        const retryButton = await screen.findByRole("button", {
            name: "Retry",
        });
        expect(screen.getByText("Synthetic policy failure.")).toBeTruthy();

        fireEvent.click(retryButton);

        await screen.findByText("Synthetic retry policy.");
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });

    test("passes axe checks when policy text is rendered", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse({
                    policyText:
                        "Synthetic Expense Policy\n\nMeals require a business purpose.",
                    updatedAt: "2026-07-24T12:00:00.000Z",
                }),
            ),
        );

        renderPolicyReferenceScreen(fetchImplementation);

        await screen.findByText(/Meals require/u);
        const axeResults = await axe.run(
            screen.getByRole("region", { name: "Policy Reference" }),
        );

        expect(axeResults.violations).toHaveLength(0);
    });
});
