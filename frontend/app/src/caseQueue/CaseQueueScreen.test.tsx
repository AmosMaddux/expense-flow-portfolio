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

import {
    AuthProvider,
    type AuthClient,
    type AuthSession,
    type Role,
} from "../auth";
import { createExpenseFlowQueryClient } from "../query/queryClient";
import {
    CaseQueueScreen,
    getReviewDialogPermissions,
    type ApprovalQueueLineItem,
} from "./CaseQueueScreen";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const baseTime = Date.parse("2026-07-22T12:00:00.000Z");

function getCheckboxByLabel(label: string): HTMLInputElement {
    const element = screen.getByLabelText(label);
    if (!(element instanceof HTMLInputElement)) {
        throw new Error(`${label} did not resolve to a checkbox input.`);
    }

    return element;
}

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
        policyChecks: [
            {
                code: "line_item_over_threshold",
                message: "Amount over $500",
                state: "uncleared",
            },
        ],
        reviewAction: null,
        deductible: false,
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
                policyChecks: [],
                reviewAction: null,
                deductible: false,
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
        policyChecks: [],
        reviewAction: null,
        deductible: false,
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
        policyChecks: [
            {
                code: "line_item_over_threshold",
                message: "Amount over $500",
                state: "uncleared",
            },
        ],
        reviewAction: "approve",
        deductible: false,
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
        policyChecks: [],
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
                policyChecks: [],
                reviewAction: null,
                deductible: false,
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
        policyChecks: [],
        reportTotalMileage: 33.2,
    },
];
const reviewedFlaggedMileageItems: ApprovalQueueLineItem[] = [
    {
        ...lineItems[0],
        flaggedLineItem: false,
        policyChecks: [],
        reviewAction: "approve",
        deductible: false,
        canAdvance: false,
        mileageEntries: lineItems[0].mileageEntries.map((entry) => ({
            ...entry,
            flaggedLineItem: true,
            policyChecks: [
                {
                    code: "line_item_over_threshold",
                    message: "Amount over $500",
                    state: "uncleared",
                },
            ],
            reviewAction: "approve",
            deductible: false,
        })),
    },
];

function createSession(roles: Role[] = ["Department Manager"]): AuthSession {
    return {
        tenantId,
        userId,
        roles,
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
    };
}

function createAuthClientMock(
    roles: Role[] = ["Department Manager"],
): AuthClient {
    return {
        login: vi.fn(() => Promise.resolve(createSession(roles))),
        refresh: vi.fn(() => Promise.resolve(createSession(roles))),
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
    roles: Role[] = ["Department Manager"],
): void {
    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClientMock(roles)}
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
    test.each([
        {
            stage: "Drafted",
            canReviewLineItems: false,
            canClearPolicyChecks: false,
            canEditDeductibility: false,
        },
        {
            stage: "Submitted",
            canReviewLineItems: false,
            canClearPolicyChecks: false,
            canEditDeductibility: false,
        },
        {
            stage: "Manager Approval",
            canReviewLineItems: true,
            canClearPolicyChecks: true,
            canEditDeductibility: false,
        },
        {
            stage: "AP Review",
            canReviewLineItems: false,
            canClearPolicyChecks: false,
            canEditDeductibility: true,
        },
        {
            stage: "Paid",
            canReviewLineItems: false,
            canClearPolicyChecks: false,
            canEditDeductibility: false,
        },
        {
            stage: "Reconciled",
            canReviewLineItems: false,
            canClearPolicyChecks: false,
            canEditDeductibility: false,
        },
    ] satisfies Array<{
        stage: ApprovalQueueLineItem["currentStage"];
        canReviewLineItems: boolean;
        canClearPolicyChecks: boolean;
        canEditDeductibility: boolean;
    }>)(
        "gates report-detail edits for the $stage stage",
        ({
            stage,
            canReviewLineItems,
            canClearPolicyChecks,
            canEditDeductibility,
        }) => {
            expect(getReviewDialogPermissions(true, stage)).toEqual({
                canAdvanceReport: stage === "Manager Approval",
                canClearPolicyChecks,
                canEditDeductibility,
                canReviewLineItems,
                canSendBackReport: stage === "Manager Approval",
            });
        },
    );

    test.each(["Manager Approval", "AP Review"] as const)(
        "keeps %s report-detail edits disabled without review capability",
        (stage) => {
            expect(getReviewDialogPermissions(false, stage)).toEqual({
                canAdvanceReport: false,
                canClearPolicyChecks: false,
                canEditDeductibility: false,
                canReviewLineItems: false,
                canSendBackReport: false,
            });
        },
    );

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
    }, 10_000);

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

    test("shows coded line items and durable $500 policy-check states in separate tabs", async () => {
        const clearedThresholdItem: ApprovalQueueLineItem = {
            ...lineItems[0],
            flaggedLineItem: false,
            policyChecks: lineItems[0].policyChecks.map((policyCheck) => ({
                ...policyCheck,
                state: "cleared",
            })),
        };
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([clearedThresholdItem])),
        );

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );

        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        expect(
            within(dialog).getByRole("tab", {
                name: "Line Items",
                selected: true,
            }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Northstar Hotels \$742\.18 - 6240 Clear/i,
            }),
        ).toBeTruthy();

        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );

        expect(
            within(dialog).getByRole("table", { name: "Policy checks" }),
        ).toBeTruthy();
        expect(
            within(dialog).getByRole("row", {
                name: /Northstar Hotels \$742\.18 6240 Amount over \$500 Cleared/i,
            }),
        ).toBeTruthy();
    });

    test("renders policy checks reported by the BFF without reconstructing amount rules", async () => {
        const nonAmountPolicyItem: ApprovalQueueLineItem = {
            ...lineItems[0],
            amount: 400,
            policyChecks: [
                {
                    code: "receipt_manual_review",
                    message: "Receipt requires manual review",
                    state: "uncleared",
                },
            ],
        };
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([nonAmountPolicyItem])),
        );

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });

        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );

        expect(
            within(dialog).getByRole("row", {
                name: /Northstar Hotels \$400\.00 6240 Receipt requires manual review Uncleared/i,
            }),
        ).toBeTruthy();
    });

    test("clears a line-item policy check from the Policy Checks tab", async () => {
        let resolveClearResponse: (response: Response) => void = () =>
            undefined;
        const clearResponse = new Promise<Response>((resolve) => {
            resolveClearResponse = resolve;
        });
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockReturnValueOnce(clearResponse);
        const promptSpy = vi
            .spyOn(window, "prompt")
            .mockReturnValue("  reviewed policy detail  ");

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );
        const policyCheckRow = within(dialog).getByRole("row", {
            name: /Northstar Hotels.*Amount over \$500.*Uncleared/i,
        });

        fireEvent.click(
            within(policyCheckRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        expect(promptSpy).toHaveBeenCalledWith(
            "Reason for clearing this flag",
            "reviewed receipt detail",
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
            sourceIds: ["a7a69670-b8ad-4850-9d55-4c15db31786f"],
            reason: "reviewed policy detail",
        });
        expect(within(policyCheckRow).getByText("Cleared")).toBeTruthy();
        expect(
            within(policyCheckRow)
                .getByRole("button", { name: "Clear flag" })
                .hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Line Items" }),
        );
        expect(
            within(dialog).getByRole("row", {
                name: /Northstar Hotels \$742\.18 - 6240 Clear/i,
            }),
        ).toBeTruthy();

        resolveClearResponse(createJsonResponse({ clearedFlagCount: 1 }));
        await waitFor(() =>
            expect(screen.queryByText("Clearing flag...")).toBeNull(),
        );
        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );
        expect(
            within(dialog)
                .getByRole("button", { name: "Clear flag" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("makes both detail tabs read-only outside role-editable stages", async () => {
        const paidItem: ApprovalQueueLineItem = {
            ...lineItems[2],
            currentStage: "Paid",
        };
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([paidItem])),
        );

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0193/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        const lineItemRow = within(dialog).getByRole("row", {
            name: /Zenith Air/i,
        });

        expect(
            within(lineItemRow)
                .getByRole("button", { name: "Approve" })
                .hasAttribute("disabled"),
        ).toBe(true);
        expect(
            within(lineItemRow)
                .getByRole("button", { name: "Reject" })
                .hasAttribute("disabled"),
        ).toBe(true);
        expect(
            within(lineItemRow).getByRole("checkbox").hasAttribute("disabled"),
        ).toBe(true);

        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );

        expect(
            within(dialog)
                .getByRole("button", { name: "Clear flag" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("keeps review controls read-only when the session lacks review capability", async () => {
        const fullyReviewedItem: ApprovalQueueLineItem = {
            ...lineItems[0],
            canAdvance: true,
            reviewAction: "approve",
            mileageEntries: lineItems[0].mileageEntries.map((entry) => ({
                ...entry,
                reviewAction: "approve",
            })),
        };
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([fullyReviewedItem])),
        );

        renderCaseQueueScreen(fetchImplementation, createNoRetryQueryClient(), [
            "Employee",
        ]);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        const lineItemRow = within(dialog).getByRole("row", {
            name: /Northstar Hotels/i,
        });

        for (const actionName of ["Approve", "Reject", "Clear flag"]) {
            expect(
                within(lineItemRow)
                    .getByRole("button", { name: actionName })
                    .hasAttribute("disabled"),
            ).toBe(true);
        }
        expect(
            within(dialog)
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
        expect(
            within(dialog).queryByRole("button", {
                name: "Reject / Send back to Drafted",
            }),
        ).toBeNull();

        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );
        expect(
            within(dialog)
                .getByRole("button", { name: "Clear flag" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("allows a Finance Admin to use Manager Approval review controls", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation, createNoRetryQueryClient(), [
            "Finance Admin",
        ]);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        const lineItemRow = within(dialog).getByRole("row", {
            name: /Northstar Hotels/i,
        });

        for (const actionName of ["Approve", "Reject", "Clear flag"]) {
            expect(
                within(lineItemRow)
                    .getByRole("button", { name: actionName })
                    .hasAttribute("disabled"),
            ).toBe(false);
        }
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
                    policyChecks: lineItems[0].policyChecks.map(
                        (policyCheck) => ({
                            ...policyCheck,
                            state: "cleared",
                        }),
                    ),
                    reviewAction: "approve",
                    deductible: false,
                    canAdvance: false,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    flaggedLineItem: false,
                    policyChecks: lineItems[0].policyChecks.map(
                        (policyCheck) => ({
                            ...policyCheck,
                            state: "cleared",
                        }),
                    ),
                    reviewAction: "approve",
                    deductible: false,
                    canAdvance: true,
                    mileageEntries: lineItems[0].mileageEntries.map(
                        (entry) => ({
                            ...entry,
                            reviewAction: "approve",
                            deductible: false,
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

    test("rolls back Policy Checks tab flag clearing when the API rejects the action", async () => {
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
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );
        const policyCheckRow = within(dialog).getByRole("row", {
            name: /Northstar Hotels.*Amount over \$500.*Uncleared/i,
        });
        fireEvent.click(
            within(policyCheckRow).getByRole("button", {
                name: "Clear flag",
            }),
        );

        await waitFor(() =>
            expect(within(policyCheckRow).getByText("Cleared")).toBeTruthy(),
        );
        expect(
            within(policyCheckRow)
                .getByRole("button", { name: "Clear flag" })
                .hasAttribute("disabled"),
        ).toBe(true);

        resolveClearResponse(createProblemResponse("Synthetic clear failure."));

        expect(
            await screen.findByText("Synthetic clear failure."),
        ).toBeTruthy();
        expect(within(policyCheckRow).getByText("Uncleared")).toBeTruthy();
        await waitFor(() =>
            expect(
                within(policyCheckRow)
                    .getByRole("button", { name: "Clear flag" })
                    .hasAttribute("disabled"),
            ).toBe(false),
        );
        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Line Items" }),
        );
        expect(
            within(dialog).getByRole("row", {
                name: /Northstar Hotels \$742\.18 - 6240 Over \$500/i,
            }),
        ).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Advance" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("clears a mileage policy check from the Policy Checks tab with the mileage source id", async () => {
        const mileageFlaggedLineItems = [
            {
                ...lineItems[0],
                flaggedLineItem: false,
                policyChecks: [],
                mileageEntries: lineItems[0].mileageEntries.map((entry) => ({
                    ...entry,
                    flaggedLineItem: true,
                    policyChecks: [
                        {
                            code: "line_item_over_threshold",
                            message: "Amount over $500",
                            state: "uncleared",
                        },
                    ],
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
        const dialog = screen.getByRole("dialog", {
            name: "Report d104c9ca",
        });
        fireEvent.click(
            within(dialog).getByRole("tab", { name: "Policy Checks" }),
        );
        const mileagePolicyCheckRow = within(dialog).getByRole("row", {
            name: /Office to client site.*Amount over \$500.*Uncleared/i,
        });
        fireEvent.click(
            within(mileagePolicyCheckRow).getByRole("button", {
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
                    deductible: false,
                    canAdvance: false,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[0],
                    reviewAction: "reject",
                    deductible: false,
                    canAdvance: false,
                    mileageEntries: lineItems[0].mileageEntries.map(
                        (entry) => ({
                            ...entry,
                            reviewAction: "reject",
                            deductible: false,
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

    test("toggles the manual deductibility checkbox during AP Review", async () => {
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(lineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[2],
                    deductible: true,
                }),
            );

        renderCaseQueueScreen(fetchImplementation);

        const zenithRow = await screen.findByRole("row", {
            name: /Employee 0193/i,
        });
        fireEvent.click(
            within(zenithRow).getByRole("button", { name: "Review" }),
        );

        const checkbox = getCheckboxByLabel("Mark Zenith Air as deductible");
        expect(checkbox.disabled).toBe(false);
        expect(checkbox.checked).toBe(false);

        fireEvent.click(checkbox);

        await waitFor(() => expect(checkbox.checked).toBe(true));
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db003/sources/line_item/e6f4d30b-20fc-4a72-9e44-190eb7d30c72/deductibility",
        );
        expect(fetchImplementation.mock.calls[1]?.[1]?.method).toBe("PATCH");
        expect(
            JSON.parse(fetchImplementation.mock.calls[1]?.[1]?.body as string),
        ).toEqual({ deductible: true });
    });

    test("keeps AP Review deductibility read-only without review capability", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation, createNoRetryQueryClient(), [
            "Employee",
        ]);

        const zenithRow = await screen.findByRole("row", {
            name: /Employee 0193/i,
        });
        fireEvent.click(
            within(zenithRow).getByRole("button", { name: "Review" }),
        );

        expect(
            getCheckboxByLabel("Mark Zenith Air as deductible").disabled,
        ).toBe(true);
    });

    test("clears the manual deductibility checkbox during AP Review", async () => {
        const deductibleLineItems = lineItems.map((lineItem) =>
            lineItem.id === "e6f4d30b-20fc-4a72-9e44-190eb7d30c72"
                ? { ...lineItem, deductible: true }
                : lineItem,
        );
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(deductibleLineItems))
            .mockResolvedValueOnce(
                createJsonResponse({
                    ...lineItems[2],
                    deductible: false,
                }),
            );

        renderCaseQueueScreen(fetchImplementation);

        const zenithRow = await screen.findByRole("row", {
            name: /Employee 0193/i,
        });
        fireEvent.click(
            within(zenithRow).getByRole("button", { name: "Review" }),
        );

        const checkbox = getCheckboxByLabel("Mark Zenith Air as deductible");
        expect(checkbox.disabled).toBe(false);
        expect(checkbox.checked).toBe(true);

        fireEvent.click(checkbox);

        await waitFor(() => expect(checkbox.checked).toBe(false));
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/d104c9ca-9de7-4f85-bb23-ed907e9db003/sources/line_item/e6f4d30b-20fc-4a72-9e44-190eb7d30c72/deductibility",
        );
        expect(fetchImplementation.mock.calls[1]?.[1]?.method).toBe("PATCH");
        expect(
            JSON.parse(fetchImplementation.mock.calls[1]?.[1]?.body as string),
        ).toEqual({ deductible: false });
    });

    test("toggles a nested mileage deductibility checkbox during AP Review", async () => {
        const apReviewMileageItems = multiLineReportItems.map((lineItem) => ({
            ...lineItem,
            currentStage: "AP Review" as const,
            reviewAction: "approve" as const,
            mileageEntries: lineItem.mileageEntries.map((entry) => ({
                ...entry,
                reviewAction: "approve" as const,
                deductible: false,
            })),
        }));
        const updatedLineItem = {
            ...apReviewMileageItems[0],
            mileageEntries: apReviewMileageItems[0].mileageEntries.map(
                (entry) =>
                    entry.id === "73000000-0000-4000-8000-000000000005"
                        ? { ...entry, deductible: true }
                        : entry,
            ),
        };
        const fetchImplementation = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(createJsonResponse(apReviewMileageItems))
            .mockResolvedValueOnce(createJsonResponse(updatedLineItem));

        renderCaseQueueScreen(fetchImplementation);

        const reportRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(reportRow).getByRole("button", { name: "Review" }),
        );

        const checkbox = getCheckboxByLabel(
            "Mark Airport to regional office as deductible",
        );
        expect(checkbox.disabled).toBe(false);
        expect(checkbox.checked).toBe(false);

        fireEvent.click(checkbox);

        await waitFor(() => expect(checkbox.checked).toBe(true));
        expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
            "/v1/expense-reports/71000000-0000-4000-8000-000000000005/sources/mileage/73000000-0000-4000-8000-000000000005/deductibility",
        );
        expect(fetchImplementation.mock.calls[1]?.[1]?.method).toBe("PATCH");
        expect(
            JSON.parse(fetchImplementation.mock.calls[1]?.[1]?.body as string),
        ).toEqual({ deductible: true });
        expect(
            getCheckboxByLabel("Mark Airport to regional office as deductible")
                .checked,
        ).toBe(true);
    });
    test("renders the deductibility checkbox read-only outside AP Review", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        const northstarRow = await screen.findByRole("row", {
            name: /Employee 0191/i,
        });
        fireEvent.click(
            within(northstarRow).getByRole("button", { name: "Review" }),
        );

        const checkbox = getCheckboxByLabel(
            "Mark Northstar Hotels as deductible",
        );
        expect(checkbox.disabled).toBe(true);
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
