import { z } from "zod";

const originSchema = z
    .url()
    .transform((value) => new URL(value))
    .refine(
        (value) =>
            value.href === value.origin || value.href === `${value.origin}/`,
        "SPA_ORIGIN must contain only a scheme and host.",
    );

const corsEnvironmentSchema = z
    .object({
        NODE_ENV: z
            .enum(["development", "test", "production"])
            .default("development"),
        SPA_ORIGIN: z.string().trim().min(1).pipe(originSchema).optional(),
    })
    .superRefine((environment, context) => {
        if (
            environment.NODE_ENV === "production" &&
            environment.SPA_ORIGIN === undefined
        ) {
            context.addIssue({
                code: "custom",
                path: ["SPA_ORIGIN"],
                message: "SPA_ORIGIN is required in production.",
            });
        }

        if (
            environment.NODE_ENV === "production" &&
            environment.SPA_ORIGIN?.protocol !== "https:"
        ) {
            context.addIssue({
                code: "custom",
                path: ["SPA_ORIGIN"],
                message: "SPA_ORIGIN must use HTTPS in production.",
            });
        }
    });

export type CorsConfig = {
    allowedOrigin: string | undefined;
};

/** Loads the single browser origin permitted to call Core Case. */
export function loadCorsConfig(
    environment: NodeJS.ProcessEnv = process.env,
): CorsConfig {
    const parsedEnvironment = corsEnvironmentSchema.parse(environment);

    return {
        allowedOrigin: parsedEnvironment.SPA_ORIGIN?.origin,
    };
}
