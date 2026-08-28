import { describe, expect, test } from "vitest";

import {
    buildClearedRefreshTokenCookie,
    buildRefreshTokenCookie,
    readRefreshTokenCookie,
} from "./refreshTokenCookie.js";

describe("refresh token cookie", () => {
    test("builds an HttpOnly, path-scoped cookie for local (non-secure) development", () => {
        const cookie = buildRefreshTokenCookie(
            "synthetic.refresh.token",
            new Date("2026-09-01T00:00:00.000Z"),
            { secure: false },
        );

        expect(cookie).toContain("ef_refresh_token=synthetic.refresh.token");
        expect(cookie).toContain("Path=/v1/auth");
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).not.toContain("Secure");
    });

    test("marks the cookie Secure with SameSite=None in production", () => {
        const cookie = buildRefreshTokenCookie(
            "synthetic.refresh.token",
            new Date("2026-09-01T00:00:00.000Z"),
            { secure: true },
        );

        expect(cookie).toContain("SameSite=None");
        expect(cookie).toContain("Secure");
    });

    test("URL-encodes the token value", () => {
        const cookie = buildRefreshTokenCookie(
            "a.b c",
            new Date("2026-09-01T00:00:00.000Z"),
            { secure: false },
        );

        expect(cookie).toContain("ef_refresh_token=a.b%20c");
    });

    test("builds a cleared cookie with an epoch expiry", () => {
        const cookie = buildClearedRefreshTokenCookie({ secure: false });

        expect(cookie).toContain("ef_refresh_token=;");
        expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });

    test("reads the refresh token value out of a Cookie header", () => {
        expect(
            readRefreshTokenCookie(
                "other=value; ef_refresh_token=synthetic.refresh.token; another=1",
            ),
        ).toBe("synthetic.refresh.token");
    });

    test("returns undefined when the cookie header is missing the token", () => {
        expect(readRefreshTokenCookie("other=value")).toBeUndefined();
        expect(readRefreshTokenCookie(undefined)).toBeUndefined();
    });

    test("round-trips a URL-encoded value", () => {
        const cookie = buildRefreshTokenCookie(
            "a.b c",
            new Date("2026-09-01T00:00:00.000Z"),
            { secure: false },
        );
        const cookieValue = cookie.split(";")[0];

        expect(readRefreshTokenCookie(cookieValue)).toBe("a.b c");
    });
});
