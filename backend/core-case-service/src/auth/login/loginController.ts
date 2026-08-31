import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import {
    InvalidCredentialsError,
    InvalidMfaCodeError,
    MfaRequiredError,
} from "../shared/authenticationErrors.js";
import type { RefreshTokenCookieConfig } from "../shared/refreshTokenCookie.js";
import { buildRefreshTokenCookie } from "../shared/refreshTokenCookie.js";
import { TokenOutboundResponseSchema } from "../refresh/refreshService.js";
import {
    loginRequestSchema,
    loginResponseSchema,
    type LoginService,
} from "./loginService.js";

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
export function createPostLogin(
    loginService: LoginService,
    cookieConfig: RefreshTokenCookieConfig,
): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const requestBody = loginRequestSchema.parse(req.body);
            const result = await loginService.login(requestBody);
            // The refresh token never leaves this handler as JSON: it is only
            // ever transported as the HttpOnly cookie set below, so page
            // JavaScript (and an XSS payload) cannot read it from the
            // response body, devtools network logs, or request/response
            // logging middleware.
            const serviceResult = loginResponseSchema.parse(result);

            res.append(
                "Set-Cookie",
                buildRefreshTokenCookie(
                    serviceResult.refreshToken,
                    new Date(serviceResult.refreshTokenExpiresAt),
                    cookieConfig,
                ),
            );
            res.status(200).json(
                TokenOutboundResponseSchema.parse(serviceResult),
            );
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
