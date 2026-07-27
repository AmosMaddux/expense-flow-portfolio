import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const receiptStorageConfigSchema = z.object({
    AWS_REGION: z.string().trim().min(1),
    RECEIPT_STORAGE_BUCKET: z.string().trim().min(3),
    RECEIPT_STORAGE_ENDPOINT: z.url().optional(),
    RECEIPT_STORAGE_FORCE_PATH_STYLE: z
        .enum(["true", "false"])
        .default("false"),
});

export type ReceiptStorageConfig = {
    bucket: string;
    endpoint?: string;
    forcePathStyle: boolean;
    region: string;
};

/**
 * Loads the S3-compatible receipt object-storage configuration.
 */
export function loadReceiptStorageConfig(
    environment: NodeJS.ProcessEnv = process.env,
): ReceiptStorageConfig {
    const parsed = receiptStorageConfigSchema.safeParse(environment);
    if (!parsed.success) {
        throw new ConfigurationError(
            "Receipt object storage is not configured.",
            { cause: parsed.error },
        );
    }

    return {
        bucket: parsed.data.RECEIPT_STORAGE_BUCKET,
        ...(parsed.data.RECEIPT_STORAGE_ENDPOINT === undefined
            ? {}
            : { endpoint: parsed.data.RECEIPT_STORAGE_ENDPOINT }),
        forcePathStyle: parsed.data.RECEIPT_STORAGE_FORCE_PATH_STYLE === "true",
        region: parsed.data.AWS_REGION,
    };
}
