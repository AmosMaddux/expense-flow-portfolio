import type { NextFunction, Request, RequestHandler, Response } from "express";

import { UnauthorizedError } from "../../errors/problem-json.js";
import type { RefreshTokenCookieConfig } from "../shared/refreshTokenCookie.js";
import {
    buildClearedRefreshTokenCookie,
    buildRefreshTokenCookie,
    readRefreshTokenCookie,
} from "../shared/refreshTokenCookie.js";
import type { LogoutService } from "./logoutService.js";
import { TokenOutboundResponseSchema, type RefreshService } from "./refreshService.js";

/**
 * Creates the HTTP handler that rotates a refresh token cookie into a fresh
 * access token, re-checking the user's status and roles from the database.
 */
export function createPostRefresh(
    refreshService: RefreshService,
    cookieConfig: RefreshTokenCookieConfig,
): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const rawRefreshToken = readRefreshTokenCookie(
                req.headers.cookie,
            );
            const { result, refreshToken, refreshTokenExpiresAt } =
                await refreshService.refresh(rawRefreshToken);

            res.append(
                "Set-Cookie",
                buildRefreshTokenCookie(
                    refreshToken,
                    refreshTokenExpiresAt,
                    cookieConfig,
                ),
            );
            res.status(200).json(TokenOutboundResponseSchema.parse(result));
        } catch (error) {
            // Only a genuine auth rejection (invalid, expired, revoked, or a
            // now-inactive user) should end the session. A transient
            // infrastructure failure (DB blip, connection pool exhaustion)
            // must not clear a still-valid cookie out from under the user.
            if (error instanceof UnauthorizedError) {
                res.append(
                    "Set-Cookie",
                    buildClearedRefreshTokenCookie(cookieConfig),
                );
            }
            next(error);
        }
    };
}

/**
 * Creates the HTTP handler that revokes the current refresh token and
 * clears its cookie. Always succeeds so the client can finish signing out.
 */
export function createPostLogout(
    logoutService: LogoutService,
    cookieConfig: RefreshTokenCookieConfig,
): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const rawRefreshToken = readRefreshTokenCookie(
                req.headers.cookie,
            );
            await logoutService.logout(rawRefreshToken);

            res.append(
                "Set-Cookie",
                buildClearedRefreshTokenCookie(cookieConfig),
            );
            res.status(204).end();
        } catch (error) {
            next(error);
        }
    };
}
