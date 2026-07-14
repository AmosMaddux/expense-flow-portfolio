import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
    mfaEnrollmentRequestSchema,
    type MfaEnrollmentService,
} from "./mfaEnrollmentService.js";

/**
 * Creates the HTTP handler for TOTP MFA enrollment.
 */
export function createPostMfaEnrollment(
    mfaEnrollmentService: MfaEnrollmentService,
): RequestHandler {
    return async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const requestBody = mfaEnrollmentRequestSchema.parse(req.body);
            const result = await mfaEnrollmentService.enroll(requestBody);

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    };
}
