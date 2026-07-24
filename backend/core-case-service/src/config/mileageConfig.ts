import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const mileageConfigSchema = z.object({
    MILEAGE_REIMBURSEMENT_RATE: z.coerce.number().positive().max(100),
});

export type MileageConfig = {
    reimbursementRate: number;
};

/**
 * Loads the configured per-mile reimbursement rate.
 */
export function loadMileageConfig(
    environment: NodeJS.ProcessEnv = process.env,
): MileageConfig {
    const parsed = mileageConfigSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "MILEAGE_REIMBURSEMENT_RATE must be a positive number.",
            { cause: parsed.error },
        );
    }

    return {
        reimbursementRate: parsed.data.MILEAGE_REIMBURSEMENT_RATE,
    };
}
