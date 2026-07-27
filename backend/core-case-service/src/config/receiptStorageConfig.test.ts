import { describe, expect, test } from "vitest";

import { ConfigurationError } from "../errors/problem-json.js";

import { loadReceiptStorageConfig } from "./receiptStorageConfig.js";

void describe("receipt storage configuration", () => {
    void test("loads an S3-compatible local configuration", () => {
        expect(
            loadReceiptStorageConfig({
                AWS_REGION: "us-east-1",
                RECEIPT_STORAGE_BUCKET: "synthetic-receipts",
                RECEIPT_STORAGE_ENDPOINT: "http://127.0.0.1:59000",
                RECEIPT_STORAGE_FORCE_PATH_STYLE: "true",
            }),
        ).toEqual({
            bucket: "synthetic-receipts",
            endpoint: "http://127.0.0.1:59000",
            forcePathStyle: true,
            region: "us-east-1",
        });
    });

    void test("rejects missing receipt storage configuration", () => {
        expect(() => loadReceiptStorageConfig({})).toThrow(ConfigurationError);
    });
});
