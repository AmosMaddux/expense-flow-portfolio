import { Router } from "express";

import { createPostLogin } from "./loginController.js";
import type { LoginService } from "./loginService.js";

/**
 * Creates authentication routes for the Identity & Auth service.
 */
export function createAuthRouter(loginService: LoginService): Router {
    const router = Router();

    router.post("/auth/login", createPostLogin(loginService));

    return router;
}
