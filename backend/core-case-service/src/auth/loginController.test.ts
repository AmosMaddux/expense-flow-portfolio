import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import { InvalidCredentialsError } from "./authenticationErrors.js";
import { createPostLogin } from "./loginController.js";
import type { LoginService } from "./loginService.js";

type TestResponse = Response & {
    statusMock: ReturnType<typeof vi.fn>;
    jsonMock: ReturnType<typeof vi.fn>;
};

function createResponse(): TestResponse {
    const response = {} as TestResponse;
    const statusMock = vi.fn(() => response);
    const jsonMock = vi.fn(() => response);

    response.statusMock = statusMock;
    response.jsonMock = jsonMock;
    response.status = statusMock;
    response.json = jsonMock;

    return response;
}

void describe("login controller", () => {
    void test("returns refresh token after primary credentials and MFA pass", async () => {
        const loginMock = vi.fn(() =>
            Promise.resolve({
                tenantId: "00000000-0000-4000-8000-000000000601",
                userId: "10000000-0000-4000-8000-000000000601",
                refreshToken: "synthetic-refresh-token",
                refreshTokenExpiresAt: "2026-08-13T12:00:00.000Z",
            }),
        );
        const loginService: LoginService = {
            login: loginMock,
        };
        const handler = createPostLogin(loginService);
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId: "00000000-0000-4000-8000-000000000601",
                email: "employee@example.invalid",
                password: "synthetic-login-password",
                totpCode: "123456",
            },
        } as Request;

        await handler(request, response, next);

        expect(loginMock).toHaveBeenCalledWith(request.body);
        expect(response.statusMock).toHaveBeenCalledWith(200);
        expect(response.jsonMock).toHaveBeenCalledWith({
            tenantId: "00000000-0000-4000-8000-000000000601",
            userId: "10000000-0000-4000-8000-000000000601",
            refreshToken: "synthetic-refresh-token",
            refreshTokenExpiresAt: "2026-08-13T12:00:00.000Z",
        });
        expect(next).not.toHaveBeenCalled();
    });

    void test("returns the same generic 401 for invalid credentials", async () => {
        const loginService: LoginService = {
            login: vi.fn(() => Promise.reject(new InvalidCredentialsError())),
        };
        const handler = createPostLogin(loginService);
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId: "00000000-0000-4000-8000-000000000602",
                email: "missing@example.invalid",
                password: "synthetic-login-password",
                totpCode: "123456",
            },
        } as Request;

        await handler(request, response, next);

        expect(response.statusMock).toHaveBeenCalledWith(401);
        expect(response.jsonMock).toHaveBeenCalledWith({
            message: "Invalid email or password.",
        });
        expect(next).not.toHaveBeenCalled();
    });
});
