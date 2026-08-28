import { Router } from "express";

import {
    createPostLogin,
    createPostUnsupportedAuthLogin,
} from "./loginController.js";
import type { LoginService } from "./loginService.js";
import { createPostMfaEnrollment } from "../mfa/mfaEnrollmentController.js";
import type { MfaEnrollmentService } from "../mfa/mfaEnrollmentService.js";
import { createPostLogout, createPostRefresh } from "../refresh/refreshController.js";
import type { LogoutService } from "../refresh/logoutService.js";
import type { RefreshService } from "../refresh/refreshService.js";
import type { RefreshTokenCookieConfig } from "../shared/refreshTokenCookie.js";

/**
 * Creates authentication routes for the Identity & Auth service.
 */
export function createAuthRouter(
    loginService: LoginService,
    mfaEnrollmentService: MfaEnrollmentService,
    refreshService: RefreshService,
    logoutService: LogoutService,
    refreshCookieConfig: RefreshTokenCookieConfig,
): Router {
    const router = Router();

    router.post(
        "/auth/login",
        createPostLogin(loginService, refreshCookieConfig),
    );
    router.post("/auth/sso/login", createPostUnsupportedAuthLogin());
    router.post("/auth/saml/login", createPostUnsupportedAuthLogin());
    router.post("/auth/oidc/login", createPostUnsupportedAuthLogin());
    router.post(
        "/auth/mfa/enroll",
        createPostMfaEnrollment(mfaEnrollmentService),
    );
    router.post(
        "/auth/refresh",
        createPostRefresh(refreshService, refreshCookieConfig),
    );
    router.post(
        "/auth/logout",
        createPostLogout(logoutService, refreshCookieConfig),
    );

    return router;
}
