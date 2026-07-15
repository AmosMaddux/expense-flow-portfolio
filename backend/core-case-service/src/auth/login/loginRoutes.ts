import { Router } from "express";

import { createPostLogin } from "./loginController.js";
import type { LoginService } from "./loginService.js";
import { createPostMfaEnrollment } from "../mfa/mfaEnrollmentController.js";
import type { MfaEnrollmentService } from "../mfa/mfaEnrollmentService.js";

/**
 * Creates authentication routes for the Identity & Auth service.
 */
export function createAuthRouter(
    loginService: LoginService,
    mfaEnrollmentService: MfaEnrollmentService,
): Router {
    const router = Router();

    router.post("/auth/login", createPostLogin(loginService));
    router.post(
        "/auth/mfa/enroll",
        createPostMfaEnrollment(mfaEnrollmentService),
    );

    return router;
}
