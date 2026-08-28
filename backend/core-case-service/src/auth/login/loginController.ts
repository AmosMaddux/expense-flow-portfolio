import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import {
    InvalidCredentialsError,
    InvalidMfaCodeError,
    MfaRequiredError,
} from "../shared/authenticationErrors.js";
import { UnauthorizedError } from "../../errors/problem-json.js";
import {
    loginRequestSchema,
    loginResponseSchema,
    type LoginService,
} from "./loginService.js";
import {
    refreshSessionResponseSchema,
    type SessionService,
} from "./sessionService.js";

export const loginErrorResponseSchema = z.object({
    code: z.enum(["INVALID_CREDENTIALS", "MFA_REQUIRED", "INVALID_MFA_CODE"]),
    message: z.string().min(1),
});

const invalidCredentialsResponse = loginErrorResponseSchema.parse({
    code: "INVALID_CREDENTIALS",
    message: "Invalid email or password.",
});
const mfaRequiredResponse = loginErrorResponseSchema.parse({
    code: "MFA_REQUIRED",
    message: "MFA code is required.",
});
const invalidMfaCodeResponse = loginErrorResponseSchema.parse({
    code: "INVALID_MFA_CODE",
    message: "Invalid or expired MFA code.",
});
const refreshCookieName = "__Host-expenseflow_refresh";

export const unsupportedAuthProblemResponseSchema = z.object({
    type: z.literal("about:blank"),
    title: z.literal("Not Implemented"),
    status: z.literal(501),
    detail: z.literal("SSO/SAML/OIDC login is not supported in the MVP."),
    instance: z.string().min(1),
});

/**
 * Creates the HTTP handler for the primary login credential step.
 */
export function createPostLogin(loginService: LoginService): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const requestBody = loginRequestSchema.parse(req.body);
            const result = await loginService.login(requestBody);
            const responseBody = loginResponseSchema.parse(result);

            setRefreshTokenCookie(
                res,
                responseBody.refreshToken,
                new Date(responseBody.refreshTokenExpiresAt),
            );
            res.status(200).json(responseBody);
        } catch (error) {
            if (error instanceof InvalidCredentialsError) {
                res.status(401).json(invalidCredentialsResponse);
                return;
            }

            if (error instanceof MfaRequiredError) {
                res.status(401).json(mfaRequiredResponse);
                return;
            }

            if (error instanceof InvalidMfaCodeError) {
                res.status(401).json(invalidMfaCodeResponse);
                return;
            }

            next(error);
        }
    };
}

/**
 * Creates the HTTP handler that restores an access-token session from the refresh cookie.
 */
export function createPostRefresh(sessionService: SessionService): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const refreshToken = readRefreshTokenCookie(req);
            const responseBody = refreshSessionResponseSchema.parse(
                await sessionService.refresh(refreshToken),
            );

            res.status(200).json(responseBody);
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Creates the HTTP handler that revokes the current refresh-token session.
 */
export function createPostLogout(sessionService: SessionService): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await sessionService.logout(readOptionalRefreshTokenCookie(req));
            clearRefreshTokenCookie(res);
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Creates the HTTP handler that deliberately rejects unsupported SSO/SAML/OIDC login paths.
 */
export function createPostUnsupportedAuthLogin(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const responseBody = unsupportedAuthProblemResponseSchema.parse({
                type: "about:blank",
                title: "Not Implemented",
                status: 501,
                detail: "SSO/SAML/OIDC login is not supported in the MVP.",
                instance: req.originalUrl,
            });

            res.status(501).type("application/problem+json").json(responseBody);
        } catch (error) {
            next(error);
        }
    };
}

function setRefreshTokenCookie(
    res: Response,
    refreshToken: string,
    expires: Date,
): void {
    res.cookie(refreshCookieName, refreshToken, {
        expires,
        httpOnly: true,
        path: "/v1/auth",
        sameSite: "none",
        secure: true,
    });
}

function clearRefreshTokenCookie(res: Response): void {
    res.clearCookie(refreshCookieName, {
        httpOnly: true,
        path: "/v1/auth",
        sameSite: "none",
        secure: true,
    });
}

function readRefreshTokenCookie(req: Request): string {
    const token = readOptionalRefreshTokenCookie(req);

    if (token === undefined) {
        throw new UnauthorizedError("A valid refresh token is required.");
    }

    return token;
}

function readOptionalRefreshTokenCookie(req: Request): string | undefined {
    const cookies = req.headers.cookie?.split(";") ?? [];

    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.trim().split("=");
        if (name === refreshCookieName) {
            return decodeURIComponent(valueParts.join("="));
        }
    }

    return undefined;
}
