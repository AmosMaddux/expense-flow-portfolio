import type { NextFunction, Request, RequestHandler, Response } from "express";

import { InvalidCredentialsError } from "./authenticationErrors.js";
import {
    loginRequestSchema,
    loginResponseSchema,
    type LoginService,
} from "./loginService.js";

const invalidCredentialsResponse = {
    message: "Invalid email or password.",
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
            const responseBody = loginResponseSchema.parse(result);

            res.status(200).json(responseBody);
        } catch (error) {
            if (error instanceof InvalidCredentialsError) {
                res.status(401).json(invalidCredentialsResponse);
                return;
            }

            next(error);
        }
    };
}
