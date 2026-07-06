import express, { type Request, type Response } from "express";
import * as swaggerUi from "swagger-ui-express";

import { problemJsonErrorHandler } from "./errors/problem-json.js";
import { coreCaseServiceOpenApiDocument } from "./openapi/core-case-service.openapi.js";

export const app = express();

app.use(express.json());

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
    swaggerUi.serve,
    swaggerUi.setup(coreCaseServiceOpenApiDocument as swaggerUi.JsonObject, {
        customSiteTitle: "ExpenseFlow Core Case Service API Docs",
    }),
);

app.use(problemJsonErrorHandler);
