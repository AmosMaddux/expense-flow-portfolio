import { z } from "zod";

import { ConfigurationError } from "../errors/problem-json.js";

const receiptStorageConfigSchema = z.object({
    AWS_REGION: z.string().trim().min(1),
    RECEIPT_STORAGE_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
    RECEIPT_STORAGE_BUCKET: z.string().trim().min(3),
    RECEIPT_STORAGE_ENDPOINT: z.url().optional(),
    RECEIPT_STORAGE_FORCE_PATH_STYLE: z
        .enum(["true", "false"])
        .default("false"),
    RECEIPT_STORAGE_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
});

export type ReceiptStorageConfig = {
    bucket: string;
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
    };
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
    const hasAccessKey =
        parsed.data.RECEIPT_STORAGE_ACCESS_KEY_ID !== undefined;
    const hasSecretKey =
        parsed.data.RECEIPT_STORAGE_SECRET_ACCESS_KEY !== undefined;
    if (hasAccessKey !== hasSecretKey) {
        throw new ConfigurationError(
            "Receipt object storage credentials must include both access key and secret key.",
        );
    }

    return {
        bucket: parsed.data.RECEIPT_STORAGE_BUCKET,
        ...(parsed.data.RECEIPT_STORAGE_ACCESS_KEY_ID === undefined ||
        parsed.data.RECEIPT_STORAGE_SECRET_ACCESS_KEY === undefined
            ? {}
            : {
                  credentials: {
                      accessKeyId: parsed.data.RECEIPT_STORAGE_ACCESS_KEY_ID,
                      secretAccessKey:
                          parsed.data.RECEIPT_STORAGE_SECRET_ACCESS_KEY,
                  },
              }),
        ...(parsed.data.RECEIPT_STORAGE_ENDPOINT === undefined
            ? {}
            : { endpoint: parsed.data.RECEIPT_STORAGE_ENDPOINT }),
        forcePathStyle: parsed.data.RECEIPT_STORAGE_FORCE_PATH_STYLE === "true",
        region: parsed.data.AWS_REGION,
    };
}
