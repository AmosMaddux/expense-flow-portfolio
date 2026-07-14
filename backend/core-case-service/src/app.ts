import express, { type Request, type Response } from "express";
import { apiReference } from "@scalar/express-api-reference";

import { createAuthRouter } from "./auth/loginRoutes.js";
import { createLoginService } from "./auth/loginService.js";
import { createDrizzleLoginCredentialRepository } from "./auth/loginRepository.js";
import { createMfaEnrollmentService } from "./auth/mfaEnrollmentService.js";
import { createDrizzleMfaEnrollmentRepository } from "./auth/mfaEnrollmentRepository.js";
import { createPasswordHasher } from "./auth/passwordHasher.js";
import { createTotpSecretProtector } from "./auth/totpSecretProtector.js";
import { loadPasswordHashConfig } from "./config/passwordHashConfig.js";
import { db } from "./db/client.js";
import { problemJsonErrorHandler } from "./errors/problem-json.js";
import { expenseReportRouter } from "./expenseReports/routes/expenseReportRoutes.js";
import { coreCaseServiceOpenApiDocument } from "./openapi/core-case-service.openapi.js";

export const app = express();

app.use(express.json());

app.use(
    "/",
    createAuthRouter(
        createLoginService(
            createDrizzleLoginCredentialRepository(db),
            createPasswordHasher(loadPasswordHashConfig()),
            createTotpSecretProtector(),
        ),
        createMfaEnrollmentService(
            createDrizzleMfaEnrollmentRepository(db),
            createTotpSecretProtector(),
        ),
    ),
);
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
