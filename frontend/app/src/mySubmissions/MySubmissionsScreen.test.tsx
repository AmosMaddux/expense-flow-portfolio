import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";
import { MySubmissionsScreen } from "./MySubmissionsScreen";

const tenantId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";

function createSession(): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Employee"],
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: "2026-07-27T13:00:00.000Z",
    };
}

function renderScreen(fetchImplementation: typeof fetch): void {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    const authClient: AuthClient = {
        login: vi.fn(() => Promise.resolve(createSession())),
        refresh: vi.fn(() => Promise.resolve(createSession())),
        logout: vi.fn(() => Promise.resolve()),
    };

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={authClient}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => Date.parse("2026-07-27T12:00:00.000Z")}
            >
                <MySubmissionsScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("MySubmissionsScreen", () => {
    test("renders each report stage position and only overdue reports get an Overdue badge", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            id: "30000000-0000-4000-8000-000000000001",
                            dueDate: "2026-07-26",
                            currentStage: "Manager Approval",
                            onHold: false,
                            isOverdue: true,
                            createdAt: "2026-07-20T12:00:00.000Z",
                            updatedAt: "2026-07-25T12:00:00.000Z",
                        },
                        {
                            id: "30000000-0000-4000-8000-000000000002",
                            dueDate: "2026-08-01",
                            currentStage: "Paid",
                            onHold: false,
                            isOverdue: false,
                            createdAt: "2026-07-21T12:00:00.000Z",
                            updatedAt: "2026-07-26T12:00:00.000Z",
                        },
                    ]),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                ),
            ),
        );

        renderScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "My Submissions" }),
        ).toBeTruthy();
        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledWith(
                "/v1/expense-reports/my-submissions",
                expect.any(Object),
            ),
        );

        const overdueReport = screen.getByLabelText(
            "Expense Report 30000000-0000-4000-8000-000000000001",
        );
        expect(within(overdueReport).getByText("Overdue")).toBeTruthy();
        expect(
            within(overdueReport).getByRole("list", {
                name: "Expense Report stage progress",
            }),
        ).toBeTruthy();
        expect(
            within(overdueReport)
                .getByText("Manager Approval", { selector: "li span" })
                .closest("li")
                ?.getAttribute("aria-current"),
        ).toBe("step");

        const onTrackReport = screen.getByLabelText(
            "Expense Report 30000000-0000-4000-8000-000000000002",
        );
        expect(within(onTrackReport).queryByText("Overdue")).toBeNull();
    });

    test("renders an empty state when the employee has no reports", async () => {
        renderScreen(
            vi.fn<typeof fetch>(() =>
                Promise.resolve(
                    new Response("[]", {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    }),
                ),
            ),
        );

        expect(
            await screen.findByRole("heading", { name: "No submissions yet" }),
        ).toBeTruthy();
    });
});
