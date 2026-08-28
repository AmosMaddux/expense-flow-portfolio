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
const locationSearchMock = vi.hoisted(
    (): { current: Record<string, unknown> } => ({ current: {} }),
);

vi.mock("@tanstack/react-router", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    useLocation: () => ({ search: locationSearchMock.current }),
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
        if (input === "/v1/gl-mappings") {
            return Promise.resolve(
                createJsonResponse({
                    mappings: [
                        "Travel",
                        "Meals",
                        "Lodging",
                        "Mileage",
                        "Office Supplies",
                        "Software",
                        "Other",
                    ].map((category, index) => ({
                        id: `70000000-0000-4000-8000-00000000030${index}`,
                        category,
                        glCodeId: `70000000-0000-4000-8000-00000000031${index}`,
                        accountCode: `600${index}`,
                        accountName: category,
                        description: null,
                        updatedAt: "2026-07-24T12:00:00.000Z",
                    })),
                    glCodes: [],
                }),
            );
        }
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
            typeof input === "string" &&
            input.startsWith(
                `/v1/expense-reports/${reportId}/receipt-uploads/`,
            ) &&
            init?.method === "PUT"
        ) {
            const uploadId = input.split("/receipt-uploads/")[1]?.split("?")[0];

            return Promise.resolve(
                createJsonResponse(
                    {
                        uploadId,
                        filename: "receipt.pdf",
                        contentType: "application/pdf",
                        sizeBytes: 17,
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
    locationSearchMock.current = {};
});

describe("SubmitExpenseScreen", () => {
    test("shows a single page context with an informational Drafted badge", async () => {
        renderScreen(createFetchMock());

        const draftedBadge = await screen.findByText("Drafted");

        expect(screen.queryByText("Employee Portal")).toBeNull();
        expect(draftedBadge.className).toContain("ef-badge--info");
    });

    test("opens a selected returned draft and edits or deletes its saved entries", async () => {
        locationSearchMock.current = { draftId: reportId };
        vi.spyOn(window, "confirm").mockReturnValue(true);
        let content = {
            expenseReportId: reportId,
            lineItems: [
                {
                    id: lineItemId,
                    merchant: "Synthetic Cafe",
                    expenseDate: "2026-07-20",
                    category: "Meals",
                    amount: 12,
                    currency: "USD",
                },
            ],
            receipts: [],
            mileageEntries: [
                {
                    id: receiptId,
                    route: "Synthetic Office to Site A",
                    distance: 10,
                    mileageDate: "2026-07-20",
                    reimbursementAmount: 6.7,
                },
            ],
        };
        const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
            if (
                input ===
                    `/v1/expense-reports/${reportId}/line-items/${lineItemId}` &&
                init?.method === "PATCH"
            ) {
                content = {
                    ...content,
                    lineItems: [
                        {
                            ...content.lineItems[0],
                            merchant: "Synthetic Updated Cafe",
                            amount: 18.5,
                        },
                    ],
                };
                return Promise.resolve(createJsonResponse(content));
            }
            if (
                input ===
                    `/v1/expense-reports/${reportId}/mileage-entries/${receiptId}` &&
                init?.method === "DELETE"
            ) {
                content = { ...content, mileageEntries: [] };
                return Promise.resolve(createJsonResponse(content));
            }
            if (
                input === `/v1/expense-reports/${reportId}/draft-content` &&
                (init?.method === undefined || init.method === "GET")
            ) {
                return Promise.resolve(createJsonResponse(content));
            }

            return Promise.resolve(createJsonResponse({}, 404));
        });

        renderScreen(fetchImplementation);

        expect(await screen.findByText("Selected Draft")).toBeTruthy();
        expect(
            fetchImplementation.mock.calls.some(
                ([input]) => input === "/v1/expense-reports/drafts/current",
            ),
        ).toBe(false);

        const lineItemRow = screen.getByText("Synthetic Cafe").closest("li");
        if (lineItemRow === null) {
            throw new Error("Expected the saved line-item row.");
        }
        fireEvent.click(
            within(lineItemRow).getByRole("button", { name: "Edit" }),
        );
        fireEvent.change(screen.getByLabelText("Merchant"), {
            target: { value: "Synthetic Updated Cafe" },
        });
        fireEvent.change(screen.getByLabelText("Amount"), {
            target: { value: "18.50" },
        });
        fireEvent.click(
            within(lineItemRow).getByRole("button", {
                name: "Save changes",
            }),
        );

        expect(await screen.findByText("Synthetic Updated Cafe")).toBeTruthy();

        const mileageRow = screen
            .getByText("Synthetic Office to Site A")
            .closest("li");
        if (mileageRow === null) {
            throw new Error("Expected the saved mileage row.");
        }
        fireEvent.click(
            within(mileageRow).getByRole("button", { name: "Delete" }),
        );

        await waitFor(() =>
            expect(screen.queryByText("Synthetic Office to Site A")).toBeNull(),
        );
    });

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
            const uploadCall = fetchImplementation.mock.calls.find(
                ([input, init]) =>
                    typeof input === "string" &&
                    input.includes("/receipt-uploads/") &&
                    init?.method === "PUT",
            );
            expect(uploadCall?.[1]?.body).toBe(receipt);

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
                    uploadId: string;
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
            expect(contentBody.receipts[0]?.uploadId).toEqual(
                expect.any(String),
            );
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

        const newDraftBadge = await screen.findByText("New Draft");
        expect(newDraftBadge.className).toContain("ef-badge--neutral");
        expect(screen.queryByText("Synthetic Meal Vendor")).toBeNull();
        expect(
            screen.queryByText(
                "Unable to load your draft. Try again before continuing.",
            ),
        ).toBeNull();
        expect(screen.getByLabelText("Merchant")).toBeTruthy();
    });
});
