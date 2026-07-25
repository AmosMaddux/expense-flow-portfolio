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
        merchant: "Northstar Hotels",
        amount: 742.18,
        glCode: "6240",
        currentStage: "Manager Approval",
        flaggedLineItem: true,
    },
    {
        id: "b21bf320-a041-4ec6-8550-3c2315cc0c68",
        merchant: "Metro Meals",
        amount: 86.42,
        glCode: "6210",
        currentStage: "Submitted",
        flaggedLineItem: false,
    },
    {
        id: "e6f4d30b-20fc-4a72-9e44-190eb7d30c72",
        merchant: "Zenith Air",
        amount: 512,
        glCode: "6220",
        currentStage: "AP Review",
        flaggedLineItem: true,
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

    test("renders line item rows with merchant, amount, GL code, stage, and flag indicator", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("heading", { name: "Case Queue" }),
        ).toBeTruthy();
        expect(await screen.findByText("Northstar Hotels")).toBeTruthy();
        const table = screen.getByRole("table", {
            name: "Tenant-scoped Approval Queue line items",
        });
        expect(table).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Northstar Hotels \$742\.18 6240 Manager Approval Over \$500/i,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("row", {
                name: /Metro Meals \$86\.42 6210 Submitted Clear/i,
            }),
        ).toBeTruthy();
        expect(within(table).getAllByText("Over $500")).toHaveLength(2);
        expect(screen.getByText("Showing 3 of 3 line items")).toBeTruthy();
    });

    test("filters line items by stage", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.change(screen.getByLabelText("Filter by stage"), {
            target: { value: "AP Review" },
        });

        expect(screen.getByText("Zenith Air")).toBeTruthy();
        expect(screen.queryByText("Northstar Hotels")).toBeNull();
        expect(screen.queryByText("Metro Meals")).toBeNull();
        expect(screen.getByText("Showing 1 of 3 line items")).toBeTruthy();
    });

    test("filters line items by flag status", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.change(screen.getByLabelText("Filter by flag status"), {
            target: { value: "clear" },
        });

        expect(screen.getByText("Metro Meals")).toBeTruthy();
        expect(screen.queryByText("Northstar Hotels")).toBeNull();
        expect(screen.queryByText("Zenith Air")).toBeNull();
        expect(screen.getByText("Showing 1 of 3 line items")).toBeTruthy();
    });

    test("sorts line items from TanStack table headers", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse(lineItems)),
        );

        renderCaseQueueScreen(fetchImplementation);

        await screen.findByText("Northstar Hotels");
        fireEvent.click(screen.getByRole("button", { name: "Amount" }));

        await waitFor(() => {
            const rows = getBodyRows();
            expect(
                within(rows[0] as HTMLElement).getByText("Metro Meals"),
            ).toBeTruthy();
            expect(
                within(rows[1] as HTMLElement).getByText("Zenith Air"),
            ).toBeTruthy();
            expect(
                within(rows[2] as HTMLElement).getByText("Northstar Hotels"),
            ).toBeTruthy();
        });
    });

    test("renders an empty state for an empty line-item response", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(createJsonResponse([])),
        );

        renderCaseQueueScreen(fetchImplementation);

        expect(
            await screen.findByRole("region", {
                name: "No line items waiting for review",
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

    test("retry re-runs the query and replaces the error state with line-item rows", async () => {
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
        expect(await screen.findByText("Northstar Hotels")).toBeTruthy();
        expect(screen.queryByText("Synthetic outage.")).toBeNull();
    });
});
