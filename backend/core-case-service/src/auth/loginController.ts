import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
    InvalidCredentialsError,
    InvalidMfaCodeError,
} from "./authenticationErrors.js";
import { loginRequestSchema, type LoginService } from "./loginService.js";

const invalidCredentialsResponse = {
    message: "Invalid email or password.",
};
const invalidMfaCodeResponse = {
    message: "Invalid or expired MFA code.",
};

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

            res.status(200).json(result);
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
