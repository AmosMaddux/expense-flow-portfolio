import express, { type Request, type Response } from "express";

import { problemJsonErrorHandler } from "./errors/problem-json.js";

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

app.use(problemJsonErrorHandler);
