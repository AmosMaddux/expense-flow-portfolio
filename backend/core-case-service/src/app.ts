import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { apiReference } from "@scalar/express-api-reference";

import { createAuthRouter } from "./auth/login/loginRoutes.js";
import { createLoginService } from "./auth/login/loginService.js";
import { createDrizzleLoginCredentialRepository } from "./auth/login/loginRepository.js";
import { createMfaEnrollmentService } from "./auth/mfa/mfaEnrollmentService.js";
import { createDrizzleMfaEnrollmentRepository } from "./auth/mfa/mfaEnrollmentRepository.js";
import {
    buildAuthJwks,
    buildAuthOpenIdConfiguration,
    loadAuthJwtConfig,
} from "./config/authJwtConfig.js";
import { loadDefaultGlCodingConfig } from "./config/glCodingConfig.js";
import { loadCorsConfig } from "./config/corsConfig.js";
import { loadInternalRoutesConfig } from "./config/internalRoutesConfig.js";
import { createPasswordHasher } from "./auth/shared/passwordHasher.js";
import { createTotpSecretProtector } from "./auth/shared/totpSecretProtector.js";
import {
    createAccessTokenMiddleware,
    createAccessTokenVerifierConfig,
} from "./auth/shared/accessTokenMiddleware.js";
import { loadPasswordHashConfig } from "./config/passwordHashConfig.js";
import { loadRateLimitConfig } from "./config/rateLimitConfig.js";
import { db } from "./db/client.js";
import {
    NotFoundError,
    problemJsonErrorHandler,
} from "./errors/problem-json.js";
import { expenseReportRouter } from "./expenseReports/routes/expenseReportRoutes.js";
import { glMappingRouter } from "./glMappings/glMappingRoutes.js";
import { coreCaseServiceOpenApiDocument } from "./openapi/core-case-service.openapi.js";
import { createTenantRateLimitMiddleware } from "./rateLimit/tenantRateLimitMiddleware.js";
import { createPostgresTenantRateLimitStore } from "./rateLimit/postgresTenantRateLimitStore.js";
import { createCorsMiddleware } from "./http/corsMiddleware.js";
import {
    createRuntimeSmokeRouter,
    isGlCodingRuntimeSmokeEnabled,
} from "./runtimeSmoke/runtimeSmokeRoutes.js";

export const app = express();
const authJwtConfig = loadAuthJwtConfig();
const authJwks = buildAuthJwks(authJwtConfig);
const accessTokenVerifierConfig = createAccessTokenVerifierConfig(
    authJwtConfig.issuer,
    authJwtConfig.audience,
    authJwks,
);
loadDefaultGlCodingConfig();
app.use(createCorsMiddleware(loadCorsConfig()));
const v1Router = express.Router();
const protectedRoutePrefixes = [
    "/expense-reports",
    "/case-queue",
    "/finance-dashboard",
    "/policy-reference",
    "/transactions",
    "/gl-mappings",
];

/**
 * Blocks trusted command routes unless this process is explicitly deployed for internal traffic.
 */
export function requireInternalRoutesEnabled(
    _req: Request,
    _res: Response,
    next: NextFunction,
): void {
    if (!loadInternalRoutesConfig().enabled) {
        next(new NotFoundError("Internal routes are not enabled."));
        return;
    }

    next();
}

/*
Read each line as: "for any request whose URL starts with path, run this next."
 Multiple .use() calls with the same path prefix just keep appending to that path's chain
  — they don't override each other or replace anything.
*/

v1Router.use("/auth", express.json());

/**
 * Publishes the public JWT verification keys for downstream services.
 */
v1Router.get("/.well-known/jwks.json", (_req: Request, res: Response) => {
    res.status(200).json(authJwks);
});

/**
 * Publishes issuer metadata so API Gateway can discover the shared JWKS URI.
 */
v1Router.get(
    "/.well-known/openid-configuration",
    (_req: Request, res: Response) => {
        res.status(200).json(buildAuthOpenIdConfiguration(authJwtConfig));
    },
);
v1Router.use(
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

v1Router.use(
    onlyProtectedRoutes(createAccessTokenMiddleware(accessTokenVerifierConfig)),
);
v1Router.use(
    onlyProtectedRoutes(
        createTenantRateLimitMiddleware(
            loadRateLimitConfig(),
            createPostgresTenantRateLimitStore(db),
        ),
    ),
);
v1Router.use("/expense-reports", express.json());
v1Router.use("/case-queue", express.json());
v1Router.use("/finance-dashboard", express.json());
v1Router.use("/policy-reference", express.json());
v1Router.use("/transactions", express.json());
v1Router.use("/gl-mappings", express.json());
v1Router.use("/internal", requireInternalRoutesEnabled);
v1Router.use("/internal", express.json());
if (isGlCodingRuntimeSmokeEnabled()) {
    v1Router.use("/runtime-smoke", createRuntimeSmokeRouter());
}
v1Router.use("/", expenseReportRouter);
v1Router.use("/", glMappingRouter);

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
v1Router.get("/openapi.json", (_req: Request, res: Response) => {
    res.status(200).json(coreCaseServiceOpenApiDocument);
});

v1Router.use(
    "/docs",
    apiReference({
        pageTitle: "ExpenseFlow Core Case Service v1 API Docs",
        sources: [{ url: "/v1/openapi.json" }],
    }),
);

app.use("/v1", v1Router);
app.use(problemJsonErrorHandler);

function onlyProtectedRoutes(
    handler: express.RequestHandler,
): express.RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!isProtectedRoute(req.path)) {
            next();
            return;
        }

        handler(req, res, next);
    };
}

function isProtectedRoute(path: string): boolean {
    return protectedRoutePrefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
}
