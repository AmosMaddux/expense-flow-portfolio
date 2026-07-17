import express, { type Request, type Response } from "express";
import { apiReference } from "@scalar/express-api-reference";

import { createAuthRouter } from "./auth/login/loginRoutes.js";
import { createLoginService } from "./auth/login/loginService.js";
import { createDrizzleLoginCredentialRepository } from "./auth/login/loginRepository.js";
import { createMfaEnrollmentService } from "./auth/mfa/mfaEnrollmentService.js";
import { createDrizzleMfaEnrollmentRepository } from "./auth/mfa/mfaEnrollmentRepository.js";
import { loadAuthJwtConfig } from "./config/authJwtConfig.js";
import { createPasswordHasher } from "./auth/shared/passwordHasher.js";
import { createTotpSecretProtector } from "./auth/shared/totpSecretProtector.js";
import { createAccessTokenMiddleware } from "./auth/shared/accessTokenMiddleware.js";
import { loadPasswordHashConfig } from "./config/passwordHashConfig.js";
import { loadRateLimitConfig } from "./config/rateLimitConfig.js";
import { db } from "./db/client.js";
import { problemJsonErrorHandler } from "./errors/problem-json.js";
import { expenseReportRouter } from "./expenseReports/routes/expenseReportRoutes.js";
import { coreCaseServiceOpenApiDocument } from "./openapi/core-case-service.openapi.js";
import { createTenantRateLimitMiddleware } from "./rateLimit/tenantRateLimitMiddleware.js";
import { createPostgresTenantRateLimitStore } from "./rateLimit/postgresTenantRateLimitStore.js";

export const app = express();
const authJwtConfig = loadAuthJwtConfig();

app.use("/auth", express.json());
app.use(
    "/",
    createAuthRouter(
        createLoginService(
            createDrizzleLoginCredentialRepository(db),
            createPasswordHasher(loadPasswordHashConfig()),
            createTotpSecretProtector(),
            authJwtConfig,
        ),
        createMfaEnrollmentService(
            createDrizzleMfaEnrollmentRepository(db),
            createTotpSecretProtector(),
        ),
    ),
);
app.use("/expense-reports", createAccessTokenMiddleware(authJwtConfig));
app.use(
    "/expense-reports",
    createTenantRateLimitMiddleware(
        loadRateLimitConfig(),
        createPostgresTenantRateLimitStore(db),
    ),
);
app.use("/expense-reports", express.json());
app.use("/", expenseReportRouter);

/**
 * Returns process health information for local and deployment smoke checks.
 */
app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
        status: "UP",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

/**
 * Returns the generated OpenAPI contract for discoverability in local service runs.
 */
app.get("/openapi.json", (_req: Request, res: Response) => {
    res.status(200).json(coreCaseServiceOpenApiDocument);
});

app.use(
    "/docs",
    apiReference({
        pageTitle: "ExpenseFlow Core Case Service API Docs",
        sources: [{ url: "/openapi.json" }],
    }),
);

app.use(problemJsonErrorHandler);
