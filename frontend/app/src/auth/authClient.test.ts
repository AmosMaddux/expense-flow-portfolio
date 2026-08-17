import { describe, expect, test, vi } from "vitest";

import { AuthRequestError, createAuthClient } from "./authClient";

describe("auth client", () => {
    test("appends the versioned login path once to a backend origin", async () => {
        const fetchImplementation = vi.fn(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        code: "INVALID_CREDENTIALS",
                        message: "Invalid email or password.",
                    }),
                    {
                        status: 401,
                        headers: { "Content-Type": "application/json" },
                    },
                ),
            ),
        );
        const client = createAuthClient(
            "https://api.example.test",
            fetchImplementation,
        );

        await expect(
            client.login({
                tenantId: "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb",
                email: "employee@example.invalid",
                password: "synthetic-password",
            }),
        ).rejects.toBeInstanceOf(AuthRequestError);

        expect(fetchImplementation).toHaveBeenCalledWith(
            "https://api.example.test/v1/auth/login",
            expect.objectContaining({
                credentials: "include",
                method: "POST",
            }),
        );
    });

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
