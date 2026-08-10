import {
    Router,
    type Request,
    type Response as ExpressResponse,
} from "express";
import { z } from "zod";

import { loadDefaultGlCodingConfig } from "../config/glCodingConfig.js";
import { BadGatewayError } from "../errors/problem-json.js";

const RuntimeSmokeGlCodingQuerySchema = z.object({}).strict();

const GlCodingHealthResponseSchema = z
    .object({
        status: z.string().min(1),
        message: z.string().min(1).optional(),
    })
    .passthrough();

export const RuntimeSmokeGlCodingResponseSchema = z.object({
    dependency: z.literal("gl-coding"),
    status: z.literal("healthy"),
});

const runtimeSmokeEnvironmentSchema = z.object({
    RUNTIME_SMOKE_GL_CODING_ENABLED: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
});

/**
 * Returns whether the deployment-only GL-coding runtime smoke route is enabled.
 */
export function isGlCodingRuntimeSmokeEnabled(
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return runtimeSmokeEnvironmentSchema.parse(environment)
        .RUNTIME_SMOKE_GL_CODING_ENABLED;
}

/**
 * Builds deployment smoke routes that prove Core Case can reach dependencies.
 */
export function createRuntimeSmokeRouter(): Router {
    const router = Router();

    router.get("/gl-coding", async (req: Request, res: ExpressResponse) => {
        RuntimeSmokeGlCodingQuerySchema.parse(req.query);
        const config = loadDefaultGlCodingConfig();
        const healthUrl = `${config.GL_CODING_SERVICE_BASE_URL.replace(/\/$/, "")}/health`;

        let healthResponse: Response;
        try {
            healthResponse = await fetch(healthUrl, {
                signal: AbortSignal.timeout(config.GL_CODING_TIMEOUT_MS),
            });
        } catch (error: unknown) {
            throw new BadGatewayError(
                "Core Case could not reach the GL-coding health endpoint.",
                { cause: error },
            );
        }

        if (!healthResponse.ok) {
            throw new BadGatewayError(
                "GL-coding health endpoint returned an unhealthy response.",
            );
        }

        const healthBody: unknown = await healthResponse.json();
        const parsedHealth = GlCodingHealthResponseSchema.parse(healthBody);

        if (parsedHealth.status !== "healthy") {
            throw new BadGatewayError("GL-coding health status is unhealthy.");
        }

        const responseBody = RuntimeSmokeGlCodingResponseSchema.parse({
            dependency: "gl-coding",
            status: "healthy",
        });
        res.status(200).json(responseBody);
    });

    return router;
}
