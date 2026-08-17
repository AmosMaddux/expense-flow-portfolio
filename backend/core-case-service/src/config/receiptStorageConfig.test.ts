import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";

import { loadReceiptStorageConfig } from "./receiptStorageConfig.js";

void describe("receipt storage configuration", () => {
    void test("loads an S3-compatible local configuration", () => {
        expect(
            loadReceiptStorageConfig({
                AWS_REGION: "us-east-1",
                RECEIPT_STORAGE_ACCESS_KEY_ID: "synthetic-access-key",
                RECEIPT_STORAGE_BUCKET: "synthetic-receipts",
                RECEIPT_STORAGE_ENDPOINT: "http://127.0.0.1:59000",
                RECEIPT_STORAGE_FORCE_PATH_STYLE: "true",
                RECEIPT_STORAGE_SECRET_ACCESS_KEY: "synthetic-secret-key",
            }),
        ).toEqual({
            bucket: "synthetic-receipts",
            credentials: {
                accessKeyId: "synthetic-access-key",
                secretAccessKey: "synthetic-secret-key",
            },
            endpoint: "http://127.0.0.1:59000",
            forcePathStyle: true,
            region: "us-east-1",
        });
    });

    void test("rejects partial receipt storage credentials", () => {
        expect(() =>
            loadReceiptStorageConfig({
                AWS_REGION: "us-east-1",
                RECEIPT_STORAGE_ACCESS_KEY_ID: "synthetic-access-key",
                RECEIPT_STORAGE_BUCKET: "synthetic-receipts",
            }),
        ).toThrow(ConfigurationError);
    });

    void test("rejects missing receipt storage configuration", () => {
        expect(() => loadReceiptStorageConfig({})).toThrow(ConfigurationError);
    });
});
