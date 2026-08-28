import { describe, expect, test, vi } from "vitest";

import { UnauthorizedError } from "../../errors/problem-json.js";
import type { LogoutService } from "./logoutService.js";
import { createPostLogout, createPostRefresh } from "./refreshController.js";
import type { RefreshService } from "./refreshService.js";

describe("refresh controller", () => {
    test("sets a rotated cookie and returns only access token fields on success", async () => {
        const refreshService: RefreshService = {
            refresh: vi.fn(() =>
                Promise.resolve({
                    result: {
                        tenantId: "00000000-0000-4000-8000-000000000801",
                        userId: "10000000-0000-4000-8000-000000000801",
                        accessToken: "synthetic-access-token",
                        accessTokenExpiresAt: "2026-08-27T12:15:00.000Z",
                    },
                    refreshToken: "synthetic-rotated-refresh-token",
                    refreshTokenExpiresAt: new Date("2026-09-26T12:00:00.000Z"),
                }),
            ),
        };
        const handler = createPostRefresh(refreshService, { secure: false });
        const res = createResponse();
        const next = vi.fn();

        await handler(
            { headers: { cookie: "ef_refresh_token=synthetic-old-token" } } as never,
            res as never,
            next,
        );

        expect(res.appendMock).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining("synthetic-rotated-refresh-token"),
        );
        expect(res.statusMock).toHaveBeenCalledWith(200);
        expect(res.jsonMock).toHaveBeenCalledWith({
            tenantId: "00000000-0000-4000-8000-000000000801",
            userId: "10000000-0000-4000-8000-000000000801",
            accessToken: "synthetic-access-token",
            accessTokenExpiresAt: "2026-08-27T12:15:00.000Z",
        });
        expect(next).not.toHaveBeenCalled();
    });

    test("clears the cookie when the refresh token is genuinely rejected", async () => {
        const refreshService: RefreshService = {
            refresh: vi.fn(() => Promise.reject(new UnauthorizedError())),
        };
        const handler = createPostRefresh(refreshService, { secure: false });
        const res = createResponse();
        const next = vi.fn();

        await handler(
            { headers: { cookie: "ef_refresh_token=synthetic-deactivated-token" } } as never,
            res as never,
            next,
        );

        expect(res.appendMock).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining("ef_refresh_token=;"),
        );
        expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    test("does not clear the cookie when the failure is a transient infrastructure error", async () => {
        const transientError = new Error("Connection pool exhausted.");
        const refreshService: RefreshService = {
            refresh: vi.fn(() => Promise.reject(transientError)),
        };
        const handler = createPostRefresh(refreshService, { secure: false });
        const res = createResponse();
        const next = vi.fn();

        await handler(
            { headers: { cookie: "ef_refresh_token=synthetic-valid-token" } } as never,
            res as never,
            next,
        );

        expect(res.appendMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(transientError);
    });

    test("logout revokes the token, clears the cookie, and always succeeds", async () => {
        const logoutMock = vi.fn(() => Promise.resolve());
        const logoutService: LogoutService = { logout: logoutMock };
        const handler = createPostLogout(logoutService, { secure: false });
        const res = createResponse();
        const next = vi.fn();

        await handler(
            { headers: { cookie: "ef_refresh_token=synthetic-token" } } as never,
            res as never,
            next,
        );

        expect(logoutMock).toHaveBeenCalledWith("synthetic-token");
        expect(res.appendMock).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining("ef_refresh_token=;"),
        );
        expect(res.statusMock).toHaveBeenCalledWith(204);
        expect(next).not.toHaveBeenCalled();
    });
});

function createResponse() {
    const response = {
        status: vi.fn(() => response),
        json: vi.fn(() => response),
        append: vi.fn(() => response),
        end: vi.fn(() => response),
    };

    return {
        ...response,
        statusMock: response.status,
        jsonMock: response.json,
        appendMock: response.append,
        endMock: response.end,
    };
}
