import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import {
    InvalidCredentialsError,
    InvalidMfaCodeError,
} from "../shared/authenticationErrors.js";
import {
    loginRequestSchema,
    loginResponseSchema,
    type LoginService,
} from "./loginService.js";

const invalidCredentialsResponse = {
    message: "Invalid email or password.",
};
const invalidMfaCodeResponse = {
    message: "Invalid or expired MFA code.",
};

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

            res.status(200).json(responseBody);
        } catch (error) {
            if (error instanceof InvalidCredentialsError) {
                res.status(401).json(invalidCredentialsResponse);
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
