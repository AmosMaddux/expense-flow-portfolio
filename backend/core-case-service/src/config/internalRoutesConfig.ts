import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const internalRoutesEnvironmentSchema = z.object({
    CORE_CASE_INTERNAL_ROUTES_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
});

export type InternalRoutesConfig = {
    enabled: boolean;
};

/**
 * Loads the explicit application gate for Core Case internal command routes.
 */
export function loadInternalRoutesConfig(
    environment: NodeJS.ProcessEnv = process.env,
): InternalRoutesConfig {
    const parsed = internalRoutesEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Core Case internal route configuration is invalid.",
            { cause: parsed.error },
        );
    }

    return {
        enabled: parsed.data.CORE_CASE_INTERNAL_ROUTES_ENABLED === "true",
    };
}
