import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";

import { BadGatewayError, ConflictError } from "../errors/problem-json.js";

import { createS3ReceiptStorage } from "./receiptStorage.js";

const descriptor = {
    contentType: "application/pdf",
    expenseReportId: "60000000-0000-4000-8000-000000000001",
    sizeBytes: 17,
    tenantId: "00000000-0000-4000-8000-000000000001",
    uploadId: "30000000-0000-4000-8000-000000000001",
};
const expectedObjectKey =
    "tenants/00000000-0000-4000-8000-000000000001/expense-reports/" +
    "60000000-0000-4000-8000-000000000001/receipts/" +
    "30000000-0000-4000-8000-000000000001";
const storageConfig = {
    bucket: "synthetic-receipts",
    forcePathStyle: true,
    region: "us-east-1",
};

function createClient(
    implementation: (command: unknown) => Promise<unknown>,
): Pick<S3Client, "send"> {
    return {
        send: vi.fn(implementation) as S3Client["send"],
    };
}

void describe("receipt storage", () => {
    void test("reads receipt bytes from the configured object key", async () => {
        const bytes = new TextEncoder().encode("synthetic receipt");
        const client = createClient(() =>
            Promise.resolve({
                Body: {
                    transformToByteArray: () => Promise.resolve(bytes),
                },
            }),
        );
        const storage = createS3ReceiptStorage(client, storageConfig);

        await expect(storage.get(expectedObjectKey)).resolves.toEqual(bytes);

        const command = vi.mocked(client.send).mock.calls[0]?.[0];
        expect(command).toBeInstanceOf(GetObjectCommand);
        if (!(command instanceof GetObjectCommand)) {
            throw new Error("Expected a GetObjectCommand");
        }
        expect(command.input).toMatchObject({
            Bucket: "synthetic-receipts",
            Key: expectedObjectKey,
        });
    });

    void test("uploads receipt bytes under a tenant-scoped object key", async () => {
        const client = createClient(() => Promise.resolve({}));
        const storage = createS3ReceiptStorage(client, storageConfig);
        const bytes = new TextEncoder().encode("synthetic receipt");

        await expect(storage.put(descriptor, bytes)).resolves.toEqual({
            objectKey: expectedObjectKey,
        });

        const command = vi.mocked(client.send).mock.calls[0]?.[0];
        expect(command).toBeInstanceOf(PutObjectCommand);
        if (!(command instanceof PutObjectCommand)) {
            throw new Error("Expected a PutObjectCommand");
        }
        expect(command.input).toMatchObject({
            Body: bytes,
            Bucket: "synthetic-receipts",
            ContentLength: 17,
            ContentType: "application/pdf",
            Key: expectedObjectKey,
        });
    });

    void test("verifies uploaded metadata before attaching a receipt", async () => {
        const client = createClient(() =>
            Promise.resolve({
                ContentLength: 17,
                ContentType: "application/pdf",
            }),
        );
        const storage = createS3ReceiptStorage(client, storageConfig);

        await expect(storage.verify(descriptor)).resolves.toEqual({
            objectKey: expectedObjectKey,
        });
        expect(vi.mocked(client.send).mock.calls[0]?.[0]).toBeInstanceOf(
            HeadObjectCommand,
        );
    });

    void test("rejects metadata that does not match the stored object", async () => {
        const client = createClient(() =>
            Promise.resolve({
                ContentLength: 16,
                ContentType: "application/pdf",
            }),
        );
        const storage = createS3ReceiptStorage(client, storageConfig);

        await expect(storage.verify(descriptor)).rejects.toThrow(ConflictError);
    });

    void test("maps object-storage upload failures to a safe gateway error", async () => {
        const client = createClient(() =>
            Promise.reject(new Error("synthetic storage failure")),
        );
        const storage = createS3ReceiptStorage(client, storageConfig);

        await expect(
            storage.put(
                descriptor,
                new TextEncoder().encode("synthetic receipt"),
            ),
        ).rejects.toThrow(BadGatewayError);
    });

    void test("maps object-storage read failures to a safe gateway error", async () => {
        const client = createClient(() =>
            Promise.reject(new Error("synthetic storage failure")),
        );
        const storage = createS3ReceiptStorage(client, storageConfig);

        await expect(storage.get(expectedObjectKey)).rejects.toThrow(
            BadGatewayError,
        );
    });
});
