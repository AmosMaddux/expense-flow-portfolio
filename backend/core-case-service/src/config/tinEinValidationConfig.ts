import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const environmentBooleanSchema = z
    .enum(["true", "false"])
    .transform((value) => value === "true");
const tinEinValidationEnvironmentSchema = z
    .object({
        TIN_EIN_VALIDATION_WSDL_URL: z.string().url(),
        TIN_EIN_VALIDATION_ENDPOINT_URL: z.string().url().optional(),
        TIN_EIN_VALIDATION_OPERATION_NAME: z
            .string()
            .min(1)
            .default("VerifyTaxpayer"),
        TIN_EIN_VALIDATION_STATUS_OPERATION_NAME: z
            .string()
            .min(1)
            .default("GetTaxpayerStatus"),
        TIN_EIN_VALIDATION_STATUS_ENRICHMENT_ENABLED:
            environmentBooleanSchema.default(false),
        TIN_EIN_VALIDATION_USERNAME: z.string().min(1).optional(),
        TIN_EIN_VALIDATION_PASSWORD: z.string().min(1).optional(),
        TIN_EIN_VALIDATION_TIMEOUT_MS: z.coerce
            .number()
            .int()
            .positive()
            .max(30_000)
            .default(5_000),
        TIN_EIN_VALIDATION_BREAKER_ERROR_THRESHOLD_PERCENTAGE: z.coerce
            .number()
            .int()
            .positive()
            .max(100)
            .default(50),
        TIN_EIN_VALIDATION_BREAKER_RESET_TIMEOUT_MS: z.coerce
            .number()
            .int()
            .positive()
            .max(300_000)
            .default(30_000),
    })
    .superRefine((environment, context) => {
        const hasUsername =
            environment.TIN_EIN_VALIDATION_USERNAME !== undefined;
        const hasPassword =
            environment.TIN_EIN_VALIDATION_PASSWORD !== undefined;
        if (hasUsername !== hasPassword) {
            context.addIssue({
                code: "custom",
                message:
                    "TIN/EIN validation UsernameToken configuration requires both username and password.",
                path: hasUsername
                    ? ["TIN_EIN_VALIDATION_PASSWORD"]
                    : ["TIN_EIN_VALIDATION_USERNAME"],
            });
        }
    });

export type TinEinValidationConfig = z.infer<
    typeof tinEinValidationEnvironmentSchema
>;

let defaultTinEinValidationConfig: TinEinValidationConfig | undefined;

/**
 * Reads shared TIN/EIN SOAP validation client settings from the environment.
 */
export function loadTinEinValidationConfig(
    environment: NodeJS.ProcessEnv = process.env,
): TinEinValidationConfig {
    const parsed = tinEinValidationEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map((issue) => issue.path.join("."))
            .filter((field) => field.length > 0)
            .join(", ");
        throw new ConfigurationError(
            `TIN/EIN validation configuration is invalid: ${fields}.`,
            {
                cause: parsed.error,
            },
        );
    }

    return parsed.data;
}

/**
 * Returns the process-wide shared TIN/EIN SOAP validation client settings.
 */
export function loadDefaultTinEinValidationConfig(): TinEinValidationConfig {
    defaultTinEinValidationConfig ??= loadTinEinValidationConfig();

    return defaultTinEinValidationConfig;
}
