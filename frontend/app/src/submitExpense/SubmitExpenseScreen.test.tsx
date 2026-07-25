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
import { SubmitExpenseScreen } from "./SubmitExpenseScreen";

const navigateMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    useNavigate: () => navigateMock,
}));

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const reportId = "70000000-0000-4000-8000-000000000200";
const lineItemId = "70000000-0000-4000-8000-000000000201";
const receiptId = "70000000-0000-4000-8000-000000000202";
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

function createFetchMock(
    draftContent: {
        expenseReportId: string;
        lineItems: unknown[];
        receipts: unknown[];
        mileageEntries: unknown[];
    } = {
        expenseReportId: reportId,
        lineItems: [],
        receipts: [],
        mileageEntries: [],
    },
): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>((input, init) => {
        if (input === "/v1/expense-reports/drafts/current") {
            return Promise.resolve(
                createJsonResponse({
                    id: reportId,
                    currentStage: "Drafted",
                }),
            );
        }
        if (
            input === `/v1/expense-reports/${reportId}/draft-content` &&
            (init?.method === undefined || init.method === "GET")
        ) {
            return Promise.resolve(createJsonResponse(draftContent));
        }
        if (
            input === `/v1/expense-reports/${reportId}/draft-content` &&
            init?.method === "POST"
        ) {
            return Promise.resolve(
                createJsonResponse(
                    {
                        expenseReportId: reportId,
                        lineItemIds: [lineItemId],
                        receiptIds: [receiptId],
                    },
                    201,
                ),
            );
        }
        if (
            input === `/v1/expense-reports/${reportId}/submit` &&
            init?.method === "POST"
        ) {
            return Promise.resolve(
                createJsonResponse(
                    {
                        id: reportId,
                        currentStage: "Submitted",
                    },
                    201,
                ),
            );
        }

        return Promise.resolve(createJsonResponse({}, 404));
    });
}

function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
}

function renderScreen(
    fetchImplementation: typeof fetch,
    queryClient = createTestQueryClient(),
): ReturnType<typeof render> {
    return render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock()}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <SubmitExpenseScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigateMock.mockClear();
});

describe("SubmitExpenseScreen", () => {
    test("shows zod validation errors for an empty line item", async () => {
        renderScreen(createFetchMock());

        const submitButton = await screen.findByRole("button", {
            name: "Submit Expense Report",
        });
        await waitFor(() =>
            expect(submitButton.hasAttribute("disabled")).toBe(false),
        );
        fireEvent.click(submitButton);

        expect(await screen.findByText("Merchant is required.")).toBeTruthy();
        expect(screen.getByText("Expense date is required.")).toBeTruthy();
        expect(screen.getByText("Choose a category.")).toBeTruthy();
        expect(
            screen.getByText("Amount must be greater than zero."),
        ).toBeTruthy();
    });

    test("adds and removes editable line items", async () => {
        renderScreen(createFetchMock());

        fireEvent.click(
            await screen.findByRole("button", { name: "Add line item" }),
        );

        expect(screen.getByText("Line item 2")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "Remove line item 2" }),
        );
        expect(screen.queryByText("Line item 2")).toBeNull();
    });

    test("attaches receipt metadata and submits with idempotency keys", async () => {
        const fetchImplementation = createFetchMock();
        renderScreen(fetchImplementation);

        fireEvent.change(await screen.findByLabelText("Merchant"), {
            target: { value: "Synthetic Conference Center" },
        });
        fireEvent.change(screen.getByLabelText("Expense date"), {
            target: { value: "2026-07-23" },
        });
        fireEvent.change(screen.getByLabelText("Category"), {
            target: { value: "Travel" },
        });
        fireEvent.change(screen.getByLabelText("Amount (USD)"), {
            target: { value: "125.50" },
        });
        const receipt = new File(["synthetic receipt"], "receipt.pdf", {
            type: "application/pdf",
        });
        fireEvent.change(screen.getByLabelText("Receipt"), {
            target: { files: [receipt] },
        });
        fireEvent.click(
            screen.getByRole("button", {
                name: "Submit Expense Report",
            }),
        );

        expect(
            await screen.findByRole("heading", { name: "Expense submitted" }),
        ).toBeTruthy();
        await waitFor(() => {
            const contentCall = fetchImplementation.mock.calls.find(
                ([input, init]) =>
                    input === `/v1/expense-reports/${reportId}/draft-content` &&
                    init?.method === "POST",
            );
            const submitCall = fetchImplementation.mock.calls.find(
                ([input]) => input === `/v1/expense-reports/${reportId}/submit`,
            );
            expect(contentCall).toBeDefined();
            expect(submitCall).toBeDefined();

            const rawContentBody = contentCall?.[1]?.body;
            if (typeof rawContentBody !== "string") {
                throw new Error("Expected a JSON draft-content request body.");
            }
            const contentBody = JSON.parse(rawContentBody) as {
                lineItems: unknown[];
                receipts: Array<{
                    filename: string;
                    contentType: string;
                    lineItemIndex: number;
                }>;
            };
            expect(contentBody.lineItems).toHaveLength(1);
            expect(contentBody.receipts).toEqual([
                expect.objectContaining({
                    filename: "receipt.pdf",
                    contentType: "application/pdf",
                    lineItemIndex: 0,
                }),
            ]);
            expect(
                new Headers(contentCall?.[1]?.headers).get("Idempotency-Key"),
            ).toBeTruthy();
            expect(
                new Headers(submitCall?.[1]?.headers).get("Idempotency-Key"),
            ).toBeTruthy();
        });
    });

    test("saves line items as Drafted without submitting the report", async () => {
        const fetchImplementation = createFetchMock();
        renderScreen(fetchImplementation);

        fireEvent.change(await screen.findByLabelText("Merchant"), {
            target: { value: "Synthetic Rail" },
        });
        fireEvent.change(screen.getByLabelText("Expense date"), {
            target: { value: "2026-07-23" },
        });
        fireEvent.change(screen.getByLabelText("Category"), {
            target: { value: "Travel" },
        });
        fireEvent.change(screen.getByLabelText("Amount (USD)"), {
            target: { value: "48.25" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

        expect(await screen.findByText("Draft saved.")).toBeTruthy();
        expect(screen.getByText("Saved in this draft")).toBeTruthy();
        expect(screen.getByText("Synthetic Rail")).toBeTruthy();
        expect(fetchImplementation).not.toHaveBeenCalledWith(
            `/v1/expense-reports/${reportId}/submit`,
            expect.anything(),
        );
    });

    test("saves the draft before opening Mileage Tracker", async () => {
        const fetchImplementation = createFetchMock();
        renderScreen(fetchImplementation);

        fireEvent.change(await screen.findByLabelText("Merchant"), {
            target: { value: "Synthetic Air" },
        });
        fireEvent.change(screen.getByLabelText("Expense date"), {
            target: { value: "2026-07-23" },
        });
        fireEvent.change(screen.getByLabelText("Category"), {
            target: { value: "Travel" },
        });
        fireEvent.change(screen.getByLabelText("Amount (USD)"), {
            target: { value: "300" },
        });
        fireEvent.click(
            screen.getByRole("button", {
                name: "Save Draft & Log Mileage",
            }),
        );

        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith({
                to: "/log-mileage",
            });
        });
        expect(
            fetchImplementation.mock.calls.some(
                ([input]) =>
                    input === `/v1/expense-reports/${reportId}/draft-content`,
            ),
        ).toBe(true);
    });

    test("reloads saved expenses and submits without duplicating them", async () => {
        const fetchImplementation = createFetchMock({
            expenseReportId: reportId,
            lineItems: [
                {
                    id: lineItemId,
                    merchant: "Synthetic Hotel",
                    expenseDate: "2026-07-22",
                    category: "Lodging",
                    amount: 225,
                    currency: "USD",
                },
            ],
            receipts: [],
            mileageEntries: [
                {
                    id: "70000000-0000-4000-8000-000000000203",
                    route: "Synthetic Office → Synthetic Client",
                    distance: 10,
                    mileageDate: "2026-07-23",
                    reimbursementAmount: 7,
                },
            ],
        });
        renderScreen(fetchImplementation);

        expect(await screen.findByText("Synthetic Hotel")).toBeTruthy();
        expect(
            screen.getByText("Synthetic Office → Synthetic Client"),
        ).toBeTruthy();
        expect(
            screen.getByText("2026-07-23 · Mileage · 10 miles"),
        ).toBeTruthy();
        const reimbursementSummary = screen.getByRole("group", {
            name: "Draft reimbursement summary",
        });
        expect(
            within(reimbursementSummary).getByText("Expense reimbursement"),
        ).toBeTruthy();
        expect(
            within(reimbursementSummary).getByText("Mileage reimbursement"),
        ).toBeTruthy();
        expect(
            within(reimbursementSummary).getByText("Total reimbursement"),
        ).toBeTruthy();
        expect(
            screen.getByText(/Purchases such as airfare, lodging, meals/),
        ).toBeTruthy();
        expect(
            screen.getByText(/Business miles driven in your personal vehicle/),
        ).toBeTruthy();
        expect(screen.queryByText("Reimbursable")).toBeNull();
        fireEvent.click(
            screen.getByRole("button", { name: "Submit Expense Report" }),
        );

        expect(
            await screen.findByRole("heading", { name: "Expense submitted" }),
        ).toBeTruthy();
        const contentPosts = fetchImplementation.mock.calls.filter(
            ([input, init]) =>
                input === `/v1/expense-reports/${reportId}/draft-content` &&
                init?.method === "POST",
        );
        expect(contentPosts).toHaveLength(0);
    });

    test("returns to a brand-new form after submitting the current draft", async () => {
        const existingContent = {
            expenseReportId: reportId,
            lineItems: [
                {
                    id: lineItemId,
                    merchant: "Synthetic Meal Vendor",
                    expenseDate: "2026-07-22",
                    category: "Meals",
                    amount: 13,
                    currency: "USD",
                },
            ],
            receipts: [],
            mileageEntries: [],
        };
        const baseFetch = createFetchMock(existingContent);
        let wasSubmitted = false;
        const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
            if (
                input === "/v1/expense-reports/drafts/current" &&
                wasSubmitted
            ) {
                return createJsonResponse(
                    {
                        detail: "No Drafted Expense Report was found.",
                    },
                    404,
                );
            }

            const response = await baseFetch(input, init);
            if (
                input === `/v1/expense-reports/${reportId}/submit` &&
                init?.method === "POST"
            ) {
                wasSubmitted = true;
            }

            return response;
        });
        const queryClient = createTestQueryClient();
        const firstRender = renderScreen(fetchImplementation, queryClient);

        expect(await screen.findByText("Synthetic Meal Vendor")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "Submit Expense Report" }),
        );
        expect(
            await screen.findByRole("heading", { name: "Expense submitted" }),
        ).toBeTruthy();

        firstRender.unmount();
        renderScreen(fetchImplementation, queryClient);

        expect(await screen.findByText("New Draft")).toBeTruthy();
        expect(screen.queryByText("Synthetic Meal Vendor")).toBeNull();
        expect(
            screen.queryByText(
                "Unable to load your draft. Try again before continuing.",
            ),
        ).toBeNull();
        expect(screen.getByLabelText("Merchant")).toBeTruthy();
    });
});
