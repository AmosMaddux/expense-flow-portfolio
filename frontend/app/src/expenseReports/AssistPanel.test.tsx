import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AuthProvider, type AuthSession } from "../auth";

import { AssistPanel, type AssistPanelCaseContext } from "./AssistPanel";

const tenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const userId = "cf8ea46a-778d-4634-9363-f4864a3d4424";
const reportId = "40000000-0000-4000-8000-000000000001";
const otherReportId = "40000000-0000-4000-8000-000000000002";
const lineItemId = "50000000-0000-4000-8000-000000000001";
const baseTime = Date.parse("2026-08-24T12:00:00.000Z");

function createSession(): AuthSession {
    return {
        tenantId,
        userId,
        roles: ["Department Manager"],
        accessToken: "synthetic-assist-access-token",
        accessTokenExpiresAt: new Date(baseTime + 5 * 60_000).toISOString(),
    };
}

function createAuthClientMock() {
    return {
        login: vi.fn(() => Promise.resolve(createSession())),
        refresh: vi.fn(() => Promise.resolve(createSession())),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function defaultCaseContext(
    expenseReportId = reportId,
): AssistPanelCaseContext {
    return {
        expenseReportId,
        lineItems: [
            {
                id: lineItemId,
                label: "Synthetic Transit - 500.01 USD",
            },
        ],
    };
}

function renderAssistPanel(fetchImplementation: typeof fetch) {
    const authClient = createAuthClientMock();
    const renderPanel = (caseContext: AssistPanelCaseContext) => (
        <AuthProvider
            authClient={authClient}
            clearCache={() => undefined}
            fetchImplementation={fetchImplementation}
            now={() => baseTime}
        >
            <AssistPanel caseContext={caseContext} />
        </AuthProvider>
    );
    const rendered = render(renderPanel(defaultCaseContext()));
    return {
        authClient,
        renderForContext: (caseContext: AssistPanelCaseContext) =>
            rendered.rerender(renderPanel(caseContext)),
        ...rendered,
    };
}

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status: 200,
        ...init,
    });
}

function assistResponse(
    response: Partial<{
        answer: string;
        citations: string[];
        contexts: Array<{
            citation: string;
            section: string;
            content: string;
            score: number;
        }>;
        expenseReportId: string;
        lineItemId: string | null;
    }> = {},
) {
    return {
        answer: "Synthetic policy answer.",
        citations: ["policy:receipts"],
        contexts: [
            {
                citation: "policy:receipts",
                section: "Receipt requirements",
                content:
                    "Receipts are required for reimbursable transit expenses.",
                score: 0.98,
            },
        ],
        refused: false,
        abstained: false,
        refusalCategory: null,
        flagAssessment: null,
        ...response,
        caseContext: {
            expenseReportId: response.expenseReportId ?? reportId,
            lineItemId: response.lineItemId ?? null,
        },
    };
}

async function waitForSession(
    authClient: ReturnType<typeof createAuthClientMock>,
): Promise<void> {
    await waitFor(() => expect(authClient.refresh).toHaveBeenCalledTimes(1));
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("AssistPanel", () => {
    test("submits selected context and renders only cited policy chunks", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse(
                    assistResponse({
                        answer: "Synthetic Transit is reimbursable with a receipt.",
                        lineItemId,
                        contexts: [
                            {
                                citation: "policy:receipts",
                                section: "Receipt requirements",
                                content:
                                    "Receipts are required for reimbursable transit expenses.",
                                score: 0.98,
                            },
                            {
                                citation: "policy:unrelated",
                                section: "Unrelated travel policy",
                                content:
                                    "Synthetic unrelated policy text must not be shown.",
                                score: 0.75,
                            },
                        ],
                    }),
                ),
            ),
        );

        const { authClient } = renderAssistPanel(fetchImplementation);
        await waitForSession(authClient);
        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: lineItemId },
        });
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "Is this reimbursable?" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Ask Assist" }));

        expect(
            await screen.findByText(/Synthetic Transit is reimbursable/u),
        ).toBeTruthy();
        expect(
            screen.getByRole("heading", { name: "Policy sources" }),
        ).toBeTruthy();
        expect(screen.getByText(/Receipts are required/u)).toBeTruthy();
        expect(
            screen.queryByText(/Synthetic unrelated policy text/u),
        ).toBeNull();
        const [input, init] = fetchImplementation.mock.calls[0] ?? [];
        expect(input).toBe("/v1/assist");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
            question: "Is this reimbursable?",
            caseContext: { expenseReportId: reportId, lineItemId },
        });
    });

    test("renders loading and error states", async () => {
        let resolveResponse: ((value: Response) => void) | undefined;
        const fetchImplementation = vi.fn<typeof fetch>(
            () =>
                new Promise<Response>((resolve) => {
                    resolveResponse = resolve;
                }),
        );

        const { authClient } = renderAssistPanel(fetchImplementation);
        await waitForSession(authClient);
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "Is this reimbursable?" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Ask Assist" }));

        expect(screen.getByRole("status").textContent).toContain(
            "Checking the policy guidance",
        );
        expect(
            screen.getByRole<HTMLButtonElement>("button", {
                name: "Checking policy…",
            }).disabled,
        ).toBe(true);

        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(1),
        );
        await act(async () => {
            resolveResponse?.(createJsonResponse({}, { status: 500 }));
        });

        expect((await screen.findByRole("alert")).textContent).toContain(
            "Unable to answer the policy question.",
        );
    });

    test("discards a late response after the active Expense Report changes", async () => {
        let resolveResponse: ((value: Response) => void) | undefined;
        const fetchImplementation = vi.fn<typeof fetch>(
            () =>
                new Promise<Response>((resolve) => {
                    resolveResponse = resolve;
                }),
        );

        const { authClient, renderForContext } =
            renderAssistPanel(fetchImplementation);
        await waitForSession(authClient);
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "Is this reimbursable?" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Ask Assist" }));
        await waitFor(() =>
            expect(fetchImplementation).toHaveBeenCalledTimes(1),
        );

        renderForContext(defaultCaseContext(otherReportId));
        await act(async () => {
            resolveResponse?.(
                createJsonResponse(
                    assistResponse({
                        answer: "Answer for the previous Expense Report.",
                    }),
                ),
            );
        });

        expect(
            screen.queryByText("Answer for the previous Expense Report."),
        ).toBeNull();
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("");
    });

    test("passes axe checks with cited sources rendered", async () => {
        const fetchImplementation = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                createJsonResponse(
                    assistResponse({
                        citations: ["policy:meals"],
                        contexts: [
                            {
                                citation: "policy:meals",
                                section: "Meals",
                                content: "Meals require a business purpose.",
                                score: 0.92,
                            },
                        ],
                    }),
                ),
            ),
        );

        const { authClient, container } =
            renderAssistPanel(fetchImplementation);
        await waitForSession(authClient);
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "Are meals reimbursable?" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Ask Assist" }));
        await screen.findByText("Synthetic policy answer.");

        const axeResults = await axe.run(container);
        expect(axeResults.violations).toHaveLength(0);
    });
});
