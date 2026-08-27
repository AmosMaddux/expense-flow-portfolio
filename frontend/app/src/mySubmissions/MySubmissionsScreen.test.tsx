import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthClient, type AuthSession } from "../auth";
import { MySubmissionsScreen } from "./MySubmissionsScreen";

const navigateMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    useNavigate: () => navigateMock,
}));

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
    navigateMock.mockClear();
});

describe("MySubmissionsScreen", () => {
    test("renders each report stage position and only overdue reports get an Overdue badge", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        items: [
                            {
                                id: "30000000-0000-4000-8000-000000000001",
                                dueDate: "2026-07-26",
                                currentStage: "Manager Approval",
                                isSentBack: false,
                                onHold: false,
                                isOverdue: true,
                                createdAt: "2026-07-20T12:00:00.000Z",
                                updatedAt: "2026-07-25T12:00:00.000Z",
                            },
                            {
                                id: "30000000-0000-4000-8000-000000000002",
                                dueDate: "2026-08-01",
                                currentStage: "Paid",
                                isSentBack: false,
                                onHold: false,
                                isOverdue: false,
                                createdAt: "2026-07-21T12:00:00.000Z",
                                updatedAt: "2026-07-26T12:00:00.000Z",
                            },
                        ],
                        nextCursor: null,
                    }),
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
                "/v1/expense-reports/my-submissions?pageSize=25",
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
        expect(
            within(onTrackReport).getByRole("button", {
                name: "View details",
            }),
        ).toBeTruthy();
    });

    test("loads and displays employee line items when details are opened", async () => {
        const reportId = "30000000-0000-4000-8000-000000000011";
        const fetchImplementation = vi.fn<typeof fetch>((input) => {
            const path =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
            const body = path.endsWith("/submission-detail")
                ? {
                      id: reportId,
                      currentStage: "Submitted",
                      rejectionReason: null,
                      employerEin: null,
                      employerLegalName: null,
                      employerEinValidation: null,
                      lineItems: [
                          {
                              id: "40000000-0000-4000-8000-000000000011",
                              merchant: "Synthetic Rail",
                              expenseDate: "2026-07-18",
                              category: "Travel",
                              amount: 84.25,
                              currency: "USD",
                              reviewAction: null,
                          },
                      ],
                      mileageEntries: [],
                  }
                : {
                      items: [
                          {
                              id: reportId,
                              dueDate: "2026-08-01",
                              currentStage: "Submitted",
                              isSentBack: false,
                              onHold: false,
                              isOverdue: false,
                              createdAt: "2026-07-20T12:00:00.000Z",
                              updatedAt: "2026-07-21T12:00:00.000Z",
                          },
                      ],
                      nextCursor: null,
                  };

            return Promise.resolve(
                new Response(JSON.stringify(body), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                }),
            );
        });

        renderScreen(fetchImplementation);

        const report = await screen.findByLabelText(
            `Expense Report ${reportId}`,
        );
        fireEvent.click(
            within(report).getByRole("button", { name: "View details" }),
        );

        expect(await within(report).findByText("Synthetic Rail")).toBeTruthy();
        expect(within(report).getByText("Travel")).toBeTruthy();
        expect(within(report).getByText("$84.25")).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledWith(
            `/v1/expense-reports/${reportId}/submission-detail`,
            expect.any(Object),
        );
        expect(
            within(report).getByRole("button", { name: "Hide details" }),
        ).toBeTruthy();
    });

    test("shows the send-back reason and submits the selected draft from details", async () => {
        const reportId = "30000000-0000-4000-8000-000000000012";
        const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
            const path =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
            if (path.endsWith("/submit") && init?.method === "POST") {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            id: reportId,
                            currentStage: "Submitted",
                        }),
                        {
                            headers: { "Content-Type": "application/json" },
                            status: 201,
                        },
                    ),
                );
            }

            const body = path.endsWith("/submission-detail")
                ? {
                      id: reportId,
                      currentStage: "Drafted",
                      rejectionReason:
                          "Receipt does not match the submitted amount.",
                      employerEin: "123456789",
                      employerLegalName: "Synthetic Holdings LLC",
                      employerEinValidation: {
                          status: "valid",
                          isValid: true,
                          reason: null,
                          serviceReferenceId: "ref-001",
                          validatedAt: "2026-07-19T12:00:00.000Z",
                      },
                      lineItems: [
                          {
                              id: "40000000-0000-4000-8000-000000000012",
                              merchant: "Synthetic Cafe",
                              expenseDate: "2026-07-18",
                              category: "Meals",
                              amount: 24.5,
                              currency: "USD",
                              reviewAction: "reject",
                          },
                      ],
                      mileageEntries: [
                          {
                              id: "50000000-0000-4000-8000-000000000012",
                              route: "Synthetic Office to Client Site",
                              distance: 12,
                              mileageDate: "2026-07-19",
                              reimbursementAmount: 8.04,
                              currency: "USD",
                              reviewAction: "approve",
                          },
                      ],
                  }
                : {
                      items: [
                          {
                              id: reportId,
                              dueDate: "2026-08-01",
                              currentStage: "Drafted",
                              isSentBack: true,
                              onHold: false,
                              isOverdue: false,
                              createdAt: "2026-07-20T12:00:00.000Z",
                              updatedAt: "2026-07-21T12:00:00.000Z",
                          },
                      ],
                      nextCursor: null,
                  };

            return Promise.resolve(
                new Response(JSON.stringify(body), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                }),
            );
        });

        renderScreen(fetchImplementation);

        const report = await screen.findByLabelText(
            `Expense Report ${reportId}`,
        );
        expect(within(report).getByText("Sent back")).toBeTruthy();
        fireEvent.click(
            within(report).getByRole("button", { name: "View details" }),
        );

        expect(
            await within(report).findByText(
                "Receipt does not match the submitted amount.",
            ),
        ).toBeTruthy();
        expect(within(report).getByText("Denied")).toBeTruthy();
        expect(within(report).getByText("Approved")).toBeTruthy();
        fireEvent.click(
            within(report).getByRole("button", {
                name: "Submit this draft",
            }),
        );

        expect(
            await within(report).findByText("Expense Report submitted."),
        ).toBeTruthy();
        const submitCall = fetchImplementation.mock.calls.find(
            ([input]) => input === `/v1/expense-reports/${reportId}/submit`,
        );
        expect(submitCall?.[1]?.method).toBe("POST");
        expect(
            new Headers(submitCall?.[1]?.headers).get("Idempotency-Key"),
        ).toEqual(expect.any(String));
    });

    test("loads the next bounded page when the employee selects Load more", async () => {
        const firstReportId = "30000000-0000-4000-8000-000000000021";
        const secondReportId = "30000000-0000-4000-8000-000000000022";
        const fetchImplementation = vi.fn<typeof fetch>((input) => {
            const path =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
            const isNextPage = path.includes("cursor=cursor_one");
            const body = {
                items: [
                    {
                        id: isNextPage ? secondReportId : firstReportId,
                        dueDate: "2026-08-01",
                        currentStage: isNextPage ? "Submitted" : "Drafted",
                        isSentBack: false,
                        onHold: false,
                        isOverdue: false,
                        createdAt: "2026-07-20T12:00:00.000Z",
                        updatedAt: "2026-07-21T12:00:00.000Z",
                    },
                ],
                nextCursor: isNextPage ? null : "cursor_one",
            };

            return Promise.resolve(
                new Response(JSON.stringify(body), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                }),
            );
        });

        renderScreen(fetchImplementation);

        expect(
            await screen.findByLabelText(`Expense Report ${firstReportId}`),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Load more" }));

        expect(
            await screen.findByLabelText(`Expense Report ${secondReportId}`),
        ).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
        expect(fetchImplementation).toHaveBeenCalledWith(
            "/v1/expense-reports/my-submissions?cursor=cursor_one&pageSize=25",
            expect.any(Object),
        );
    });

    test("renders an empty state when the employee has no reports", async () => {
        renderScreen(
            vi.fn<typeof fetch>(() =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({ items: [], nextCursor: null }),
                        {
                            headers: { "Content-Type": "application/json" },
                            status: 200,
                        },
                    ),
                ),
            ),
        );

        expect(
            await screen.findByRole("heading", { name: "No submissions yet" }),
        ).toBeTruthy();
    });
});
