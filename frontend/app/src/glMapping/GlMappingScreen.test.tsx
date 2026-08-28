import { QueryClientProvider } from "@tanstack/react-query";
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
import { GlMappingScreen } from "./GlMappingScreen";

const mappingResponse = {
    mappings: [
        {
            id: "00000000-0000-4000-8000-000000000801",
            category: "Travel",
            glCodeId: "00000000-0000-4000-8000-000000000901",
            accountCode: "6100",
            accountName: "Travel",
            description: "Synthetic travel account",
            updatedAt: "2026-08-03T12:00:00.000Z",
        },
        {
            id: "00000000-0000-4000-8000-000000000802",
            category: "Meals",
            glCodeId: "00000000-0000-4000-8000-000000000902",
            accountCode: "6200",
            accountName: "Meals",
            description: null,
            updatedAt: "2026-08-03T12:00:00.000Z",
        },
    ],
    glCodes: [
        {
            id: "00000000-0000-4000-8000-000000000901",
            accountCode: "6100",
            accountName: "Travel",
            description: "Synthetic travel account",
        },
        {
            id: "00000000-0000-4000-8000-000000000902",
            accountCode: "6200",
            accountName: "Meals",
            description: null,
        },
    ],
};

afterEach(() => {
    cleanup();
});

describe("GlMappingScreen", () => {
    test("renders Department Manager view as read-only", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Department Manager", fetchImplementation);

        expect(await screen.findByText("Read-only")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Add mapping" })).toBeNull();
        expect(await screen.findByText("6100")).toBeTruthy();
    });

    test("shows only the GL number, not the account name, in the GL number column", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        expect(await screen.findByText("6100")).toBeTruthy();
        expect(screen.queryByText("6100 - Travel")).toBeNull();
    });

    test("edits stay page-local until Save is clicked", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        const row = (await screen.findByText("Travel")).closest("tr");
        expect(row).not.toBeNull();
        fireEvent.click(
            within(row as HTMLElement).getByRole("button", { name: "Edit" }),
        );

        fireEvent.change(screen.getByLabelText("GL number"), {
            target: { value: "6150" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Save Travel edits" }),
        );

        expect(await screen.findByText("6150")).toBeTruthy();
        expect(
            fetchImplementation.mock.calls.some(
                ([, init]) => init?.method === "PUT",
            ),
        ).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(
                fetchImplementation.mock.calls.some(
                    ([input, init]) =>
                        input === "/v1/gl-mappings" && init?.method === "PUT",
                ),
            ).toBe(true);
        });
        const [, saveInit] =
            fetchImplementation.mock.calls.find(
                ([input, init]) =>
                    input === "/v1/gl-mappings" && init?.method === "PUT",
            ) ?? [];
        const savedBody = JSON.parse(String(saveInit?.body)) as {
            updates: Array<{ id: string; accountCode: string }>;
        };
        expect(savedBody.updates).toEqual([
            {
                id: "00000000-0000-4000-8000-000000000801",
                category: "Travel",
                accountCode: "6150",
                description: "Synthetic travel account",
            },
        ]);
    });

    test("rejects a non-numeric GL number before staging the edit", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        const row = (await screen.findByText("Travel")).closest("tr");
        fireEvent.click(
            within(row as HTMLElement).getByRole("button", { name: "Edit" }),
        );
        fireEvent.change(screen.getByLabelText("GL number"), {
            target: { value: "abc" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Save Travel edits" }),
        );

        expect(
            await screen.findByText("GL number must contain only digits."),
        ).toBeTruthy();
        expect(screen.getByLabelText("GL number")).toBeTruthy();
    });

    test("adds a new mapping locally and includes it in the batch save", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        await screen.findByText("Travel");
        fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));

        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Parking" },
        });
        fireEvent.change(screen.getByLabelText("GL number"), {
            target: { value: "6700" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Save Parking" }),
        );

        expect(await screen.findByText("Parking")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(
                fetchImplementation.mock.calls.some(
                    ([input, init]) =>
                        input === "/v1/gl-mappings" && init?.method === "PUT",
                ),
            ).toBe(true);
        });
        const [, saveInit] =
            fetchImplementation.mock.calls.find(
                ([input, init]) =>
                    input === "/v1/gl-mappings" && init?.method === "PUT",
            ) ?? [];
        const savedBody = JSON.parse(String(saveInit?.body)) as {
            creates: Array<{ category: string; accountCode: string }>;
        };
        expect(savedBody.creates).toEqual([
            expect.objectContaining({
                category: "Parking",
                accountCode: "6700",
            }),
        ]);
    });

    test("stages a delete of an existing mapping, including a default mapping, until Save", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        const row = (await screen.findByText("Travel")).closest("tr");
        fireEvent.click(
            within(row as HTMLElement).getByRole("button", {
                name: "Delete Travel",
            }),
        );

        expect(screen.queryByText("Travel")).toBeNull();
        expect(
            fetchImplementation.mock.calls.some(
                ([, init]) => init?.method === "PUT",
            ),
        ).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(
                fetchImplementation.mock.calls.some(
                    ([input, init]) =>
                        input === "/v1/gl-mappings" && init?.method === "PUT",
                ),
            ).toBe(true);
        });
        const [, saveInit] =
            fetchImplementation.mock.calls.find(
                ([input, init]) =>
                    input === "/v1/gl-mappings" && init?.method === "PUT",
            ) ?? [];
        const savedBody = JSON.parse(String(saveInit?.body)) as {
            deletes: string[];
        };
        expect(savedBody.deletes).toEqual([
            "00000000-0000-4000-8000-000000000801",
        ]);
    });

    test("removing a newly-added row before Save does not include it in the batch", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        await screen.findByText("Travel");
        fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Parking" },
        });
        fireEvent.change(screen.getByLabelText("GL number"), {
            target: { value: "6700" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Save Parking" }),
        );

        const newRow = (await screen.findByText("Parking")).closest("tr");
        fireEvent.click(
            within(newRow as HTMLElement).getByRole("button", {
                name: "Remove Parking",
            }),
        );

        expect(screen.queryByText("Parking")).toBeNull();
        expect(
            screen
                .getByRole("button", { name: "Save" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });

    test("cancel discards an in-progress edit without staging a change", async () => {
        const fetchImplementation = createFetchMock();

        renderGlMappingScreen("Finance Admin", fetchImplementation);

        const row = (await screen.findByText("Travel")).closest("tr");
        fireEvent.click(
            within(row as HTMLElement).getByRole("button", { name: "Edit" }),
        );
        fireEvent.change(screen.getByLabelText("GL number"), {
            target: { value: "9999" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(await screen.findByText("6100")).toBeTruthy();
        expect(screen.queryByText("9999")).toBeNull();
        expect(
            screen
                .getByRole("button", { name: "Save" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });
});

function renderGlMappingScreen(
    role: Role,
    fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>,
): void {
    const queryClient = createExpenseFlowQueryClient();

    render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider
                authClient={createAuthClient(role)}
                fetchImplementation={fetchImplementation}
                now={() => Date.parse("2026-08-03T12:00:00.000Z")}
            >
                <GlMappingScreen />
            </AuthProvider>
        </QueryClientProvider>,
    );
}

function createAuthClient(role: Role): AuthClient {
    const session = createSession(role);

    return {
        login: vi.fn(() => Promise.resolve(session)),
        refresh: vi.fn(() => Promise.resolve(session)),
        logout: vi.fn(() => Promise.resolve()),
    };
}

function createSession(role: Role): AuthSession {
    return {
        accessToken: "synthetic-access-token",
        accessTokenExpiresAt: "2026-08-03T12:15:00.000Z",
        tenantId: "00000000-0000-4000-8000-000000000701",
        userId: "00000000-0000-4000-8000-000000000702",
        roles: [role],
    };
}

function createFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>((input, init) => {
        if (input === "/v1/gl-mappings" && init?.method === undefined) {
            return Promise.resolve(jsonResponse(mappingResponse));
        }

        if (input === "/v1/gl-mappings" && init?.method === "PUT") {
            return Promise.resolve(jsonResponse(mappingResponse));
        }

        return Promise.resolve(
            jsonResponse(
                {
                    detail: "Unexpected request.",
                },
                404,
            ),
        );
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
