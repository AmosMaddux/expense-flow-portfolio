import { Router } from "express";

import {
    createPostLogin,
    createPostLogout,
    createPostRefresh,
    createPostUnsupportedAuthLogin,
} from "./loginController.js";
import type { LoginService } from "./loginService.js";
import type { SessionService } from "./sessionService.js";
import { createPostMfaEnrollment } from "../mfa/mfaEnrollmentController.js";
import type { MfaEnrollmentService } from "../mfa/mfaEnrollmentService.js";

/**
 * Creates authentication routes for the Identity & Auth service.
 */
export function createAuthRouter(
    loginService: LoginService,
    sessionService: SessionService,
    mfaEnrollmentService: MfaEnrollmentService,
): Router {
    const router = Router();

    router.post("/auth/login", createPostLogin(loginService));
    router.post("/auth/refresh", createPostRefresh(sessionService));
    router.post("/auth/logout", createPostLogout(sessionService));
    router.post("/auth/sso/login", createPostUnsupportedAuthLogin());
    router.post("/auth/saml/login", createPostUnsupportedAuthLogin());
    router.post("/auth/oidc/login", createPostUnsupportedAuthLogin());
    router.post(
        "/auth/mfa/enroll",
        createPostMfaEnrollment(mfaEnrollmentService),
    );

    return router;
}
