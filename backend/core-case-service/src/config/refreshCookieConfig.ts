import { z } from "zod";

import type { RefreshTokenCookieConfig } from "../auth/shared/refreshTokenCookie.js";

const refreshCookieEnvironmentSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
});

/** Loads whether the refresh token cookie must be marked Secure. */
export function loadRefreshCookieConfig(
    environment: NodeJS.ProcessEnv = process.env,
): RefreshTokenCookieConfig {
    const parsedEnvironment = refreshCookieEnvironmentSchema.parse(environment);

    return { secure: parsedEnvironment.NODE_ENV === "production" };
}
