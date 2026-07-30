import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

import {
    loadReceiptStorageConfig,
    type ReceiptStorageConfig,
} from "../config/receiptStorageConfig.js";
import { BadGatewayError, ConflictError } from "../errors/problem-json.js";

export type ReceiptObjectDescriptor = {
    contentType: string;
    expenseReportId: string;
    sizeBytes: number;
    tenantId: string;
    uploadId: string;
};

export type ReceiptStorage = {
    get(objectKey: string): Promise<Uint8Array>;
    put(
        descriptor: ReceiptObjectDescriptor,
        content: Uint8Array,
    ): Promise<{ objectKey: string }>;
    verify(descriptor: ReceiptObjectDescriptor): Promise<{ objectKey: string }>;
};

type S3CommandClient = Pick<S3Client, "send">;

let defaultStorage: ReceiptStorage | undefined;

/**
 * Returns the configured S3-compatible receipt storage adapter.
 */
export function getDefaultReceiptStorage(): ReceiptStorage {
    if (defaultStorage === undefined) {
        const config = loadReceiptStorageConfig();
        defaultStorage = createS3ReceiptStorage(
            new S3Client(toS3ClientConfig(config)),
            config,
        );
    }

    return defaultStorage;
}

/**
 * Builds receipt storage operations around an S3-compatible command client.
 */
export function createS3ReceiptStorage(
    client: S3CommandClient,
    config: ReceiptStorageConfig,
): ReceiptStorage {
    return {
        async get(objectKey) {
            try {
                const response = await client.send(
                    new GetObjectCommand({
                        Bucket: config.bucket,
                        Key: objectKey,
                    }),
                );
                const body = response.Body;
                if (body === undefined) {
                    throw new Error("Receipt object body was empty.");
                }

                return body.transformToByteArray();
            } catch (error: unknown) {
                throw new BadGatewayError(
                    "Receipt storage rejected the file read.",
                    { cause: error },
                );
            }
        },
        async put(descriptor, content) {
            const objectKey = buildReceiptObjectKey(descriptor);
            try {
                await client.send(
                    new PutObjectCommand({
                        Bucket: config.bucket,
                        Key: objectKey,
                        Body: content,
                        ContentLength: descriptor.sizeBytes,
                        ContentType: descriptor.contentType,
                    }),
                );
            } catch (error: unknown) {
                throw new BadGatewayError(
                    "Receipt storage rejected the file upload.",
                    { cause: error },
                );
            }

            return { objectKey };
        },
        async verify(descriptor) {
            const objectKey = buildReceiptObjectKey(descriptor);
            let storedObject: {
                ContentLength?: number | undefined;
                ContentType?: string | undefined;
            };
            try {
                storedObject = await client.send(
                    new HeadObjectCommand({
                        Bucket: config.bucket,
                        Key: objectKey,
                    }),
                );
            } catch (error: unknown) {
                throw new ConflictError(
                    "Upload each receipt file before saving the expense.",
                    { cause: error },
                );
            }

            if (
                storedObject.ContentLength !== descriptor.sizeBytes ||
                storedObject.ContentType !== descriptor.contentType
            ) {
                throw new ConflictError(
                    "The uploaded receipt does not match its submitted metadata.",
                );
            }

            return { objectKey };
        },
    };
}

/**
 * Clears the cached storage adapter between configuration-sensitive tests.
 */
export function resetDefaultReceiptStorageForTests(): void {
    defaultStorage = undefined;
}

function buildReceiptObjectKey(descriptor: ReceiptObjectDescriptor): string {
    return [
        "tenants",
        descriptor.tenantId,
        "expense-reports",
        descriptor.expenseReportId,
        "receipts",
        descriptor.uploadId,
    ].join("/");
}

function toS3ClientConfig(config: ReceiptStorageConfig): {
    endpoint?: string;
    forcePathStyle: boolean;
    region: string;
} {
    return {
        ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
        forcePathStyle: config.forcePathStyle,
        region: config.region,
    };
}
