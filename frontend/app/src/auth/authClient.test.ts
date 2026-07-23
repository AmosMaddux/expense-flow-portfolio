import { describe, expect, test, vi } from "vitest";

import { AuthRequestError, createAuthClient } from "./authClient";

describe("auth client", () => {
    test("preserves a machine-readable MFA challenge", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        code: "MFA_REQUIRED",
                        message: "MFA code is required.",
                    }),
                    {
                        status: 401,
                        headers: { "Content-Type": "application/json" },
                    },
                ),
            ),
        );
        const client = createAuthClient("", fetchImplementation);

        await expect(
            client.login({
                tenantId: "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb",
                email: "employee@example.invalid",
                password: "synthetic-password",
            }),
        ).rejects.toMatchObject({
            name: "AuthRequestError",
            status: 401,
            code: "MFA_REQUIRED",
            message: "MFA code is required.",
        } satisfies Partial<AuthRequestError>);
    });
});
