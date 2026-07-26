import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";
import { LogMileageScreen } from "./LogMileageScreen";

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();

    return {
        ...router,
        Link: ({
            children,
            to,
            ...props
        }: AnchorHTMLAttributes<HTMLAnchorElement> & {
            to: string;
        }) => (
            <a href={to} {...props}>
                {children}
            </a>
        ),
    };
});

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const reportId = "70000000-0000-4000-8000-000000000100";
const entryId = "70000000-0000-4000-8000-000000000101";
const baseTime = Date.parse("2026-07-24T12:00:00.000Z");

function createSession(): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Employee"],
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
    };
}

function createAuthClientMock(): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(createSession())),
        refresh: vi.fn(() => Promise.resolve(createSession())),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function createJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status,
    });
}

function renderMileageScreen(fetchImplementation: typeof fetch): void {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock()}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <LogMileageScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

function createMileageFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>((input, init) => {
        if (input === "/v1/expense-reports/drafts/current") {
            return Promise.resolve(
                createJsonResponse({
                    id: reportId,
                    currentStage: "Drafted",
                }),
            );
        }
        if (input === "/v1/expense-reports/config/mileage") {
            return Promise.resolve(
                createJsonResponse({
                    ratePerMile: 0.7,
                    currency: "USD",
                }),
            );
        }
        if (
            input === `/v1/expense-reports/${reportId}/mileage-entries` &&
            init?.method === "POST"
        ) {
            return Promise.resolve(
                createJsonResponse(
                    {
                        id: entryId,
                        expenseReportId: reportId,
                        route: "Synthetic Office → Synthetic Client Site",
                        distance: 12.5,
                        mileageDate: "2026-07-23",
                        reimbursement: {
                            ratePerMile: 0.7,
                            amount: 8.75,
                            currency: "USD",
                        },
                        createdAt: "2026-07-24T12:00:00.000Z",
                        updatedAt: "2026-07-24T12:00:00.000Z",
                    },
                    201,
                ),
            );
        }

        return Promise.resolve(createJsonResponse({}, 404));
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("LogMileageScreen", () => {
    test("shows a stable mileage loading state while checking for a draft", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(
            () => new Promise<Response>(() => undefined),
        );
        renderMileageScreen(fetchImplementation);

        expect(
            await screen.findByRole("status", {
                name: "Loading Mileage Tracker",
            }),
        ).toBeTruthy();
        expect(
            screen.getByText("Checking for a Drafted Expense Report..."),
        ).toBeTruthy();
    });

    test("shows inline zod validation errors for missing trip details", async () => {
        renderMileageScreen(createMileageFetchMock());

        fireEvent.click(
            await screen.findByRole("button", { name: "Add to Draft" }),
        );

        expect(await screen.findByText("Trip date is required.")).toBeTruthy();
        expect(screen.getByText("Enter a starting point.")).toBeTruthy();
        expect(screen.getByText("Enter a destination.")).toBeTruthy();
        expect(screen.getByText("Enter the trip distance.")).toBeTruthy();
        expect(
            screen.getByLabelText("Trip Date").getAttribute("aria-invalid"),
        ).toBe("true");
    });

    test("rejects a future trip date in client-side validation", async () => {
        renderMileageScreen(createMileageFetchMock());

        fireEvent.change(await screen.findByLabelText("Trip Date"), {
            target: { value: "2999-01-01" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add to Draft" }));

        expect(
            await screen.findByText("Trip date cannot be in the future."),
        ).toBeTruthy();
    });

    test("computes the reimbursement preview from the configured rate", async () => {
        renderMileageScreen(createMileageFetchMock());

        fireEvent.change(await screen.findByLabelText("Distance (miles)"), {
            target: { value: "12.5" },
        });

        expect(await screen.findByText("$8.75")).toBeTruthy();
        expect(screen.getByText("$0.70 / mile")).toBeTruthy();
    });

    test("adds a validated mileage entry to the current draft through the API", async () => {
        const fetchImplementation = createMileageFetchMock();
        renderMileageScreen(fetchImplementation);

        fireEvent.change(await screen.findByLabelText("Trip Date"), {
            target: { value: "2026-07-23" },
        });
        fireEvent.change(screen.getByLabelText("Route (From)"), {
            target: { value: "Synthetic Office" },
        });
        fireEvent.change(screen.getByLabelText("Route (To)"), {
            target: { value: "Synthetic Client Site" },
        });
        fireEvent.change(screen.getByLabelText("Distance (miles)"), {
            target: { value: "12.5" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add to Draft" }));

        expect(
            await screen.findByText("$8.75 was added to your draft."),
        ).toBeTruthy();
        expect(
            screen
                .getByRole("link", { name: "Return to Submit Expense" })
                .getAttribute("href"),
        ).toBe("/submit-expense");
        await waitFor(() => {
            expect(fetchImplementation).toHaveBeenCalledWith(
                `/v1/expense-reports/${reportId}/mileage-entries`,
                expect.objectContaining({
                    method: "POST",
                    body: JSON.stringify({
                        route: "Synthetic Office → Synthetic Client Site",
                        distance: 12.5,
                        mileageDate: "2026-07-23",
                    }),
                }),
            );
            const mileageRequest = fetchImplementation.mock.calls.find(
                ([input]) =>
                    input ===
                    `/v1/expense-reports/${reportId}/mileage-entries`,
            );
            expect(
                new Headers(mileageRequest?.[1]?.headers).get(
                    "Idempotency-Key",
                ),
            ).toBeTruthy();
        });
        expect(
            screen.getByLabelText<HTMLInputElement>("Distance (miles)").value,
        ).toBe("");
    });
});
