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
import { createExpenseFlowQueryClient } from "../query/queryClient";
import { CaseQueueScreen, type ApprovalQueueLineItem } from "./CaseQueueScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

const lineItems: ApprovalQueueLineItem[] = [
    {
        id: "a7a69670-b8ad-4850-9d55-4c15db31786f",
        sourceType: "line_item",
        expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db001",
        employee: "50000000-0000-4000-8000-000000000191",
        merchant: "Northstar Hotels",
        amount: 742.18,
        glCode: "6240",
        currentStage: "Manager Approval",
        flaggedLineItem: true,
        reviewAction: null,
        canAdvance: false,
        reportTotalMileage: 18.5,
        mileageEntries: [
            {
                id: "f7b2017a-7d30-4d80-a360-53d00f387111",
                expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db001",
                route: "Office to client site",
                distance: 18.5,
                mileageDate: "2026-07-21",
                amount: 12.4,
                glCode: "6250",
                flaggedLineItem: false,
                reviewAction: null,
            },
        ],
    },
    {
        id: "b21bf320-a041-4ec6-8550-3c2315cc0c68",
        sourceType: "line_item",
        expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db002",
        employee: "50000000-0000-4000-8000-000000000192",
        merchant: "Metro Meals",
        amount: 86.42,
        glCode: "6210",
        currentStage: "Submitted",
        flaggedLineItem: false,
        reviewAction: null,
        canAdvance: false,
        reportTotalMileage: 0,
        mileageEntries: [],
    },
    {
        id: "e6f4d30b-20fc-4a72-9e44-190eb7d30c72",
        sourceType: "line_item",
        expenseReportId: "d104c9ca-9de7-4f85-bb23-ed907e9db003",
        employee: "50000000-0000-4000-8000-000000000193",
        merchant: "Zenith Air",
        amount: 512,
        glCode: "6220",
        currentStage: "AP Review",
        flaggedLineItem: true,
        reviewAction: "approve",
        canAdvance: false,
        reportTotalMileage: 0,
        mileageEntries: [],
    },
];
const multiLineReportItems: ApprovalQueueLineItem[] = [
    {
        ...lineItems[0],
        id: "72000000-0000-4000-8000-000000000005",
        expenseReportId: "71000000-0000-4000-8000-000000000005",
        merchant: "United Air",
        amount: 428.5,
        glCode: "6220",
        flaggedLineItem: false,
        reportTotalMileage: 24.6,
        mileageEntries: [
            {
                id: "73000000-0000-4000-8000-000000000005",
                expenseReportId: "71000000-0000-4000-8000-000000000005",
                route: "Airport to regional office",
                distance: 24.6,
                mileageDate: "2026-07-22",
                amount: 15.62,
                glCode: "6250",
                flaggedLineItem: false,
                reviewAction: null,
            },
        ],
    },
    lineItems[1],
];
const seededZenithReportItems: ApprovalQueueLineItem[] = [
    {
        ...lineItems[2],
        id: "72000000-0000-4000-8000-000000000003",
        expenseReportId: "71000000-0000-4000-8000-000000000003",
        merchant: "Zenith Air",
        amount: 512,
        glCode: "6220",
        currentStage: "Manager Approval",
        reportTotalMileage: 33.2,
    },
    {
        ...lineItems[2],
        id: "72000000-0000-4000-8000-000000000004",
        expenseReportId: "71000000-0000-4000-8000-000000000003",
        merchant: "Summit Supplies",
        amount: 44.9,
        glCode: "6260",
        currentStage: "Manager Approval",
        flaggedLineItem: false,
        reportTotalMileage: 33.2,
    },
];
const reviewedFlaggedMileageItems: ApprovalQueueLineItem[] = [
    {
        ...lineItems[0],
        flaggedLineItem: false,
        reviewAction: "approve",
        canAdvance: false,
        mileageEntries: lineItems[0].mileageEntries.map((entry) => ({
            ...entry,
            flaggedLineItem: true,
            reviewAction: "approve",
        })),
    },
];

function createSession(): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Department Manager"],
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

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status: 200,
        ...init,
    });
}

function createProblemResponse(detail: string): Response {
    return createJsonResponse(
        {
            detail,
            status: 500,
            title: "Unexpected server error",
        },
        {
            headers: { "Content-Type": "application/problem+json" },
            status: 500,
        },
    );
}

function createNoRetryQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function createFastProductionRetryQueryClient(): QueryClient {
    const queryClient = createExpenseFlowQueryClient();
    const defaultOptions = queryClient.getDefaultOptions();

    queryClient.setDefaultOptions({
        ...defaultOptions,
        queries: {
            ...defaultOptions.queries,
            retryDelay: 1,
        },
    });

    return queryClient;
}

function renderCaseQueueScreen(
    fetchImplementation: typeof fetch,
    queryClient = createNoRetryQueryClient(),
): void {
    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock()}
                clearCache={() => queryClient.clear()}
                fetchImplementation={fetchImplementation}
                now={() => baseTime}
            >
                <CaseQueueScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

function getBodyRows(): HTMLElement[] {
    return screen.getAllByRole("row").slice(1);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("CaseQueueScreen", () => {
    test("renders a loading skeleton while the Approval Queue fetch is pending", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(
            () => new Promise<Response>(() => undefined),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("status", {
                name: "Loading Approval Queue",
            }),
        ).toBeTruthy();
        await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
            "/v1/case-queue/line-items",
        );
        expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toBeInstanceOf(
            Headers,
        );
    });

    test("renders report rows with employee, submission, totals, stage, flag, and review action", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "Case Queue" }),
        ).toBeTruthy();
        expect(await screen.findByText("Employee 0191")).toBeTruthy();
        const table = screen.getByRole("table", {
            name: "Approval Queue reports",
        });
        expect(table).toBeTruthy();
        const northstarRow = screen.getByRole("row", {
            name: /Employee 0191/i,
        });
        const metroRow = screen.getByRole("row", {
            name: /Employee 0192/i,
        });
        expect(
            within(table).getByRole("columnheader", { name: "Employee" }),
        ).toBeTruthy();
        expect(
            within(table).getByRole("columnheader", { name: "Submission" }),
        ).toBeTruthy();
        expect(
            within(table).getByRole("columnheader", { name: "Total Amount" }),
        ).toBeTruthy();
        expect(
            within(table).getByRole("columnheader", { name: "Mileage" }),
        ).toBeTruthy();
        expect(
            within(table).getByRole("columnheader", { name: "Stage" }),
        ).toBeTruthy();
        expect(
            within(table).getByRole("columnheader", { name: "Flag" }),
        ).toBeTruthy();
        expect(
            within(table).getByRole("columnheader", { name: "Actions" }),
        ).toBeTruthy();
        expect(within(northstarRow).getByText("$742.18")).toBeTruthy();
        expect(within(northstarRow).getByText("18.50 miles")).toBeTruthy();
        expect(within(northstarRow).queryByText("6240")).toBeNull();
        expect(within(northstarRow).getByText("Manager Approval")).toBeTruthy();
        expect(within(northstarRow).getByText("Over $500")).toBeTruthy();
        expect(within(metroRow).getByText("$86.42")).toBeTruthy();
        expect(within(metroRow).queryByText("6210")).toBeNull();
        expect(within(metroRow).getByText("Submitted")).toBeTruthy();
        expect(within(metroRow).getByText("Clear")).toBeTruthy();
        expect(within(table).getAllByText("Over $500")).toHaveLength(2);
        expect(
            within(table).getAllByRole("button", { name: "Review" }),
        ).toHaveLength(3);
        expect(
            within(table).queryByRole("button", { name: "Approve" }),
        ).toBeNull();
        expect(
            within(table).queryByRole("button", { name: "Reject" }),
        ).toBeNull();
        expect(
            within(table).queryByRole("button", { name: "Clear flag" }),
        ).toBeNull();
        expect(screen.getByText("Showing 3 of 3 reports")).toBeTruthy();
    });

    test("filters report rows by stage", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Employee 0191");
        fireEvent.change(screen.getByLabelText("Filter by stage"), {
            target: { value: "AP Review" },
        });

        expect(screen.getByText("Employee 0193")).toBeTruthy();
        expect(screen.queryByText("Employee 0191")).toBeNull();
        expect(screen.queryByText("Employee 0192")).toBeNull();
        expect(screen.getByText("Showing 1 of 3 reports")).toBeTruthy();
    });

    test("filters report rows by the amount-over-threshold checkbox", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Employee 0191");
        fireEvent.click(screen.getByLabelText("Filter to amount over 500"));

        expect(screen.getByText("Employee 0191")).toBeTruthy();
        expect(screen.getByText("Employee 0193")).toBeTruthy();
        expect(screen.queryByText("Employee 0192")).toBeNull();
        expect(screen.getByText("Showing 2 of 3 reports")).toBeTruthy();
    });

    test("sorts report rows from TanStack table headers", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Employee 0191");
        fireEvent.click(screen.getByRole("button", { name: "Total Amount" }));

        await waitFor(() => {
            const rows = getBodyRows();
            expect(within(rows[0]).getByText("Employee 0192")).toBeTruthy();
            expect(within(rows[1]).getByText("Employee 0193")).toBeTruthy();
            expect(within(rows[2]).getByText("Employee 0191")).toBeTruthy();
        });
    });

    test("renders an empty state for an empty approval queue response", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([])),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No reports waiting for review",
            }),
        ).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    test("renders an error state when the line-item fetch fails", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createProblemResponse("Synthetic line-item outage."),
            ),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByText("Synthetic line-item outage."),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    test("does not retry an invalid line-item response shape with the production retry policy", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse([
                    {
                        currentStage: "Submitted",
                        flaggedLineItem: false,
                        glCode: "6210",
                        id: "b21bf320-a041-4ec6-8550-3c2315cc0c68",
                        merchant: "Metro Meals",
                    },
                ]),
            ),
        );

        renderCaseQueueScreen(
            fetchImplementation,
            createFastProductionRetryQueryClient(),
        );

        expect(
            await screen.findByRole("heading", {
                name: "Unable to load Approval Queue",
            }),
        ).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("retry re-runs the query and replaces the error state with report rows", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createProblemResponse("Synthetic outage."))
            .mockResolvedValueOnce(createJsonResponse(lineItems));

        renderCaseQueueScreen(fetchImplementation);

        expect(await screen.findByText("Synthetic outage.")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(await screen.findByText("Employee 0191")).toBeTruthy();
        expect(screen.queryByText("Synthetic outage.")).toBeNull();
    });

    test("opens a report review popup from the row Review button without navigating", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        window.history.replaceState(null, "", "/approval-queue");
        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );

        expect(window.location.pathname).toBe("/approval-queue");
        expect(
            screen.getByRole("dialog", {
                name: "Report d104c9ca",
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("table", { name: "Report review line items" }),
        ).toBeTruthy();
        const reviewTable = screen.getByRole("table", {
            name: "Report review line items",
        });
        expect(
            within(reviewTable).getByRole("columnheader", { name: "Mileage" }),
        ).toBeTruthy();
        expect(within(reviewTable).getByText("18.50 miles")).toBeTruthy();
        expect(
            screen.queryByRole("table", {
                name: "Report review mileage entries",
            }),
        ).toBeNull();
        expect(
            screen.getAllByRole("button", { name: "Approve" }).length,
        ).toBeGreaterThan(0);
        expect(
            screen.getAllByRole("button", { name: "Reject" }).length,
        ).toBeGreaterThan(0);
        expect(
            screen.getAllByRole("button", { name: "Clear flag" }).length,
        ).toBeGreaterThan(0);
        expect(
            screen.getByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        ).toBeTruthy();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("opens one report with a separate expense row and mileage row for review", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(multiLineReportItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        expect(within(reportRow).getByText("$428.50")).toBeTruthy();
        expect(within(reportRow).getByText("24.60 miles")).toBeTruthy();
        expect(screen.getByText("Showing 2 of 2 reports")).toBeTruthy();

        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );

        const reviewTable = screen.getByRole("table", {
            name: "Report review line items",
        });
        const unitedReviewRow = within(reviewTable).getByRole("row", {
            name: /United Air/i,
        });
        const mileageReviewRow = within(reviewTable).getByRole("row", {
            name: /Airport to regional office/i,
        });

        expect(within(unitedReviewRow).getByText("$428.50")).toBeTruthy();
        expect(within(unitedReviewRow).getByText("-")).toBeTruthy();
        expect(within(unitedReviewRow).getByText("6220")).toBeTruthy();
        expect(within(mileageReviewRow).getByText("$15.62")).toBeTruthy();
        expect(within(mileageReviewRow).getByText("24.60 miles")).toBeTruthy();
        expect(within(mileageReviewRow).getByText("6250")).toBeTruthy();
        expect(within(mileageReviewRow).getByText("Not reviewed")).toBeTruthy();
        expect(
            within(mileageReviewRow).getByRole("button", { name: "Approve" }),
        ).toBeTruthy();
        expect(
            within(mileageReviewRow).getByRole("button", { name: "Reject" }),
        ).toBeTruthy();
        expect(
            within(mileageReviewRow).getByRole("button", {
                name: "Clear flag",
            }),
        ).toBeTruthy();
        expect(screen.getAllByText("$428.50")).toHaveLength(3);
        expect(screen.getAllByText("24.60 miles")).toHaveLength(3);
    });

    test("calculates the seeded Zenith report totals from its report rows", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(seededZenithReportItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0193/i,
        });
        expect(within(reportRow).getByText("71000000")).toBeTruthy();
        expect(within(reportRow).getByText("$556.90")).toBeTruthy();
        expect(within(reportRow).getByText("33.20 miles")).toBeTruthy();

        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );

        expect(screen.getAllByText("$556.90")).toHaveLength(2);
        expect(screen.getAllByText("33.20 miles")).toHaveLength(2);
    });

    test("pulls a Submitted report into Manager Approval when a manager opens review", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    id: "d104c9ca-9de7-4f85-bb23-ed907e9db002",
                    currentStage: "Manager Approval",
                }),
            );

        renderCaseQueueScreen(fetchImplementation);

        const metroRow = await screen.findByRole("row", {
            name: /Employee 0192/i,
        });
        fireEvent.click(
            within(metroRow).getByRole("button", { name: "Review" }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(
            screen.getByRole("dialog", {
                name: "Report d104c9ca",
            }),
        ).toBeTruthy();
        expect(screen.getAllByText("Manager Approval").length).toBeGreaterThan(
            0,
        );
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db002/transitions",
        );
        const transitionRequestBody =
            fetchImplementation.mock.calls[1]?.[1]?.body;

        expect(typeof transitionRequestBody).toBe("string");
        expect(JSON.parse(transitionRequestBody as string)).toMatchObject({
            toStage: "Manager Approval",
            reason: "manager review started",
        });
    });

    test("approves a line item optimistically in the popup and rolls back when the API rejects the action", async () => {
        let resolveReviewResponse: (response: Response) => void = () =>
            undefined;
        const reviewResponse = new Promise<Response>((resolve) => {
            resolveReviewResponse = resolve;
        });
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockReturnValueOnce(reviewResponse);

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        const northstarReviewRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarReviewRow).getByRole("button", {
                name: "Approve",
            }),
        );

        await waitFor(() => expect(screen.getByText("Approved")).toBeTruthy());

        resolveReviewResponse(
            createProblemResponse("Synthetic review failure."),
        );

        expect(
            await screen.findByText("Synthetic review failure."),
        ).toBeTruthy();
        expect(screen.getAllByText("Not reviewed").length).toBeGreaterThan(0);
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/sources/line_item/a7a69670-b8ad-4850-9d55-4c15db31786f/review",
        );
    });

    test("requires every line item to be reviewed before enabling the advance action", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(createJsonResponse({ clearedFlagCount: 1 }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    flaggedLineItem: false,
                    reviewAction: "approve",
                    canAdvance: false,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    flaggedLineItem: false,
                    reviewAction: "approve",
                    canAdvance: true,
                    mileageEntries: lineItems[0].mileageEntries.map(
                        (entry) => ({
                            ...entry,
                            reviewAction: "approve",
                        }),
                    ),
                }),
            );
        vi.spyOn(window, "prompt").mockReturnValue("reviewed receipt detail");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);

        const northstarReviewRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarReviewRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(screen.getAllByText("Clear").length).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(
            within(northstarReviewRow).getByRole("button", {
                name: "Approve",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(3),
        );
        expect(screen.getByText("Approved")).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
        const mileageReviewRow = screen.getByRole("row", {
            name: /Office to client site/i,
        });
        fireEvent.click(
            within(mileageReviewRow).getByRole("button", {
                name: "Approve",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(4),
        );
        expect(screen.getAllByText("Approved").length).toBeGreaterThan(1);
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(false);
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/flags/clear",
        );
        expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/sources/line_item/a7a69670-b8ad-4850-9d55-4c15db31786f/review",
        );
        expect(fetchImplementation.mock.calls[3]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/sources/mileage/f7b2017a-7d30-4d80-a360-53d00f387111/review",
        );
    });

    test("keeps advance disabled when reviewed mileage still has an open flag", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(reviewedFlaggedMileageItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );

        expect(screen.getAllByText("Approved").length).toBeGreaterThan(1);
        expect(screen.getAllByText("Over $500").length).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("rolls back optimistic flag clearing in the popup when the API rejects the action", async () => {
        let resolveClearResponse: (response: Response) => void = () =>
            undefined;
        const clearResponse = new Promise<Response>((resolve) => {
            resolveClearResponse = resolve;
        });
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockReturnValueOnce(clearResponse);
        vi.spyOn(window, "prompt").mockReturnValue("reviewed receipt detail");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        const northstarReviewRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarReviewRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        await waitFor(() =>
            expect(screen.getAllByText("Clear").length).toBeGreaterThan(0),
        );

        resolveClearResponse(createProblemResponse("Synthetic clear failure."));

        expect(
            await screen.findByText("Synthetic clear failure."),
        ).toBeTruthy();
        expect(screen.getAllByText("Over $500").length).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("clears a mileage flag from the popup with the mileage source id", async () => {
        const mileageFlaggedLineItems = [
            {
                ...lineItems[0],
                flaggedLineItem: false,
                mileageEntries: lineItems[0].mileageEntries.map((entry) => ({
                    ...entry,
                    flaggedLineItem: true,
                })),
            },
        ];
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(mileageFlaggedLineItems))
            .mockResolvedValueOnce(createJsonResponse({ clearedFlagCount: 1 }));
        vi.spyOn(window, "prompt").mockReturnValue("reviewed mileage detail");

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );
        const mileageReviewRow = screen.getByRole("row", {
            name: /Office to client site/i,
        });
        fireEvent.click(
            within(mileageReviewRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/flags/clear",
        );
        const clearRequestBody = fetchImplementation.mock.calls[1]?.[1]?.body;

        expect(typeof clearRequestBody).toBe("string");
        expect(JSON.parse(clearRequestBody as string)).toEqual({
            sourceIds: ["f7b2017a-7d30-4d80-a360-53d00f387111"],
            reason: "reviewed mileage detail",
        });
        expect(screen.getAllByText("Clear").length).toBeGreaterThan(0);
    });

    test("sends a report back to Drafted and removes it from the manager queue", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    reviewAction: "reject",
                    canAdvance: false,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    reviewAction: "reject",
                    canAdvance: false,
                    mileageEntries: lineItems[0].mileageEntries.map(
                        (entry) => ({
                            ...entry,
                            reviewAction: "reject",
                        }),
                    ),
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    id: "d104c9ca-9de7-4f85-bb23-ed907e9db001",
                    currentStage: "Drafted",
                }),
            );
        vi.spyOn(window, "prompt").mockReturnValue(
            "employee correction needed",
        );

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        expect(
            screen
                .getByRole("button", {
                    name: "Reject / Send back to Drafted",
                })
                .hasAttribute("disabled"),
        ).toBe(true);

        const northstarReviewRow = screen.getByRole("row", {
            name: /Northstar Hotels/i,
        });
        fireEvent.click(
            within(northstarReviewRow).getByRole("button", { name: "Reject" }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(2),
        );
        expect(screen.getByText("Rejected")).toBeTruthy();
        expect(
            screen
                .getByRole("button", {
                    name: "Reject / Send back to Drafted",
                })
                .hasAttribute("disabled"),
        ).toBe(true);
        const mileageReviewRow = screen.getByRole("row", {
            name: /Office to client site/i,
        });
        fireEvent.click(
            within(mileageReviewRow).getByRole("button", { name: "Reject" }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(3),
        );
        expect(screen.getAllByText("Rejected").length).toBeGreaterThan(1);
        expect(
            screen
                .getByRole("button", {
                    name: "Reject / Send back to Drafted",
                })
                .hasAttribute("disabled"),
        ).toBe(false);

        fireEvent.click(
            screen.getByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        );

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(4),
        );
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByText("Employee 0191")).toBeNull();
        expect(screen.queryByRole("row", { name: /Drafted/i })).toBeNull();
        expect(screen.getByText("Showing 2 of 2 reports")).toBeTruthy();
        expect(fetchImplementation.mock.calls[3]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db001/transitions",
        );
        const transitionRequestBody =
            fetchImplementation.mock.calls[3]?.[1]?.body;

        expect(typeof transitionRequestBody).toBe("string");
        expect(JSON.parse(transitionRequestBody as string)).toMatchObject({
            toStage: "Drafted",
            reason: "employee correction needed",
        });
    });

    test("does not expose report send-back after a report reaches AP Review", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        const zenithRow = await screen.findByRole("row", {
            name: /Employee 0193/i,
        });
        fireEvent.click(
            within(zenithRow).getByRole("button", { name: "Review" }),
        );

        expect(
            screen.getByRole("dialog", {
                name: "Report d104c9ca",
            }),
        ).toBeTruthy();
        expect(
            screen.queryByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        ).toBeNull();
        expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test("does not send a report back when the required reason is omitted", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );
        vi.spyOn(window, "prompt").mockReturnValue("");

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        );

        expect(fetchImplementation).toHaveBeenCalledOnce();
    });
});
