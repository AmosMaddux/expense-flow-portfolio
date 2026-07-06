import express, { type Request, type Response } from "express";
import { apiReference } from "@scalar/express-api-reference";

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
    apiReference({
        pageTitle: "ExpenseFlow Core Case Service API Docs",
        sources: [{ url: "/openapi.json" }],
    }),
);

app.use(problemJsonErrorHandler);
