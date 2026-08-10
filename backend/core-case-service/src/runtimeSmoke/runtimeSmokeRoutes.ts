import { timingSafeEqual } from "node:crypto";
import {
    Router,
    type Request,
    type Response as ExpressResponse,
} from "express";
import { z } from "zod";

import { loadDefaultGlCodingConfig } from "../config/glCodingConfig.js";
import {
    BadGatewayError,
    ConfigurationError,
    UnauthorizedError,
} from "../errors/problem-json.js";

const RuntimeSmokeGlCodingQuerySchema = z.object({}).strict();
const RuntimeSmokeHeadersSchema = z
    .object({
        "x-runtime-smoke-token": z.string().min(1),
    })
    .passthrough();

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
    RUNTIME_SMOKE_SHARED_SECRET: z.string().min(32).optional(),
});

type RuntimeSmokeConfig = z.infer<typeof runtimeSmokeEnvironmentSchema>;

/**
 * Reads deployment-only runtime smoke settings from the environment.
 */
export function loadRuntimeSmokeConfig(
    environment: NodeJS.ProcessEnv = process.env,
): RuntimeSmokeConfig {
    const config = runtimeSmokeEnvironmentSchema.parse(environment);

    if (
        config.RUNTIME_SMOKE_GL_CODING_ENABLED &&
        config.RUNTIME_SMOKE_SHARED_SECRET === undefined
    ) {
        throw new ConfigurationError(
            "RUNTIME_SMOKE_SHARED_SECRET is required when GL-coding runtime smoke is enabled.",
        );
    }

    return config;
}

/**
 * Returns whether the deployment-only GL-coding runtime smoke route is enabled.
 */
export function isGlCodingRuntimeSmokeEnabled(
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return loadRuntimeSmokeConfig(environment).RUNTIME_SMOKE_GL_CODING_ENABLED;
}

/**
 * Builds deployment smoke routes that prove Core Case can reach dependencies.
 */
export function createRuntimeSmokeRouter(): Router {
    const router = Router();

    router.get("/gl-coding", async (req: Request, res: ExpressResponse) => {
        RuntimeSmokeGlCodingQuerySchema.parse(req.query);
        const runtimeSmokeConfig = loadRuntimeSmokeConfig();
        const parsedHeaders = RuntimeSmokeHeadersSchema.safeParse(req.headers);
        if (
            !parsedHeaders.success ||
            runtimeSmokeConfig.RUNTIME_SMOKE_SHARED_SECRET === undefined ||
            !secretsMatch(
                parsedHeaders.data["x-runtime-smoke-token"],
                runtimeSmokeConfig.RUNTIME_SMOKE_SHARED_SECRET,
            )
        ) {
            throw new UnauthorizedError(
                "A valid runtime smoke token is required.",
            );
        }

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

function secretsMatch(candidate: string, expected: string): boolean {
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);

    return (
        candidateBuffer.length === expectedBuffer.length &&
        timingSafeEqual(candidateBuffer, expectedBuffer)
    );
}
