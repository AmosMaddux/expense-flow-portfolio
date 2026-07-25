import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const mileageConfigSchema = z.object({
    MILEAGE_REIMBURSEMENT_RATE: z
        .string()
        .trim()
        .regex(/^\d+(?:\.\d{1,6})?$/)
        .refine((rate) => Number(rate) > 0 && Number(rate) <= 100),
});

export type MileageConfig = {
    reimbursementRate: number;
    reimbursementRateDecimal: string;
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
        reimbursementRate: Number(parsed.data.MILEAGE_REIMBURSEMENT_RATE),
        reimbursementRateDecimal: parsed.data.MILEAGE_REIMBURSEMENT_RATE,
    };
}
