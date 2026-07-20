import { describe, expect, test } from "vitest";

import {
    createCoreCaseLogger,
    logExpenseReportAuditError,
    logExpenseReportAuditSuccess,
} from "./coreCaseLogger.js";

class MemoryLogStream {
    public readonly lines: string[] = [];

    public write(line: string): void {
        this.lines.push(line);
    }
}

void describe("Core Case pino audit logging", () => {
    void test("redacts receipt PII and payment identifiers from success logs", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseLogger(stream, { timestamp: false });
        const rawPaymentId = "pay_synthetic_raw_123456789";

        logExpenseReportAuditSuccess(logger, {
            action: "receipt_attached",
            paymentId: rawPaymentId,
            receipt: {
                amount: "142.93",
                email: "employee@example.invalid",
                merchant: "Synthetic Cafe",
            },
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain(rawPaymentId);
        expect(emitted).not.toContain("142.93");
        expect(emitted).not.toContain("employee@example.invalid");
        expect(emitted).toContain("[REDACTED]");
    });

    void test("redacts receipt PII and payment identifiers from error logs", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseLogger(stream, { timestamp: false });
        const rawPaymentId = "synthetic-payment-reference";
        const uuidPaymentReference = "60000000-0000-4000-8000-000000000601";

        logExpenseReportAuditError(logger, {
            action: "receipt_processing_failed",
            error: new Error(
                `failed for ${rawPaymentId} employee@example.invalid 87.65`,
            ),
            payment: {
                id: rawPaymentId,
                processorReference: uuidPaymentReference,
            },
            receiptMetadata: {
                amount: "87.65",
                cardholderName: "Synthetic Employee",
            },
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain(rawPaymentId);
        expect(emitted).not.toContain(uuidPaymentReference);
        expect(emitted).not.toContain("87.65");
        expect(emitted).not.toContain("employee@example.invalid");
        expect(emitted).not.toContain("Synthetic Employee");
        expect(emitted).toContain("[REDACTED]");
        expect(emitted).toContain("receipt_processing_failed");
        expect(emitted).not.toContain("failed for");
    });

    void test("redacts nested payment identifiers in payment context objects", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseLogger(stream, { timestamp: false });
        const rawPaymentId = "synthetic-payment-reference";
        const rawPaymentReference = "60000000-0000-4000-8000-000000000602";
        const rawReimbursementReference = "stub-payment-2026-0001";

        logExpenseReportAuditSuccess(logger, {
            action: "payment_metadata_checked",
            paymentDetails: {
                id: rawPaymentId,
                reference: rawPaymentReference,
            },
            reimbursement: {
                paymentReferenceId: rawReimbursementReference,
            },
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain(rawPaymentId);
        expect(emitted).not.toContain(rawPaymentReference);
        expect(emitted).not.toContain(rawReimbursementReference);
        expect(emitted).toContain("[REDACTED]");
    });

    void test("redacts flat receipt-derived PII and amount pairs", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseLogger(stream, { timestamp: false });

        logExpenseReportAuditSuccess(logger, {
            action: "receipt_metadata_checked",
            amount: "$1,234.56",
            cardholderName: "Synthetic Employee",
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain("$1,234.56");
        expect(emitted).not.toContain("Synthetic Employee");
        expect(emitted).toContain("[REDACTED]");
    });

    void test("keeps non-receipt decimal strings intact", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseLogger(stream, { timestamp: false });

        logExpenseReportAuditSuccess(logger, {
            action: "workflow_metric_recorded",
            exchangeRate: "1.23",
            processingDurationSeconds: "12.34",
        });

        const emitted = stream.lines.join("");

        expect(emitted).toContain("1.23");
        expect(emitted).toContain("12.34");
    });
});
import { describe, expect, test } from "vitest";

import { createCoreCaseAuditLogger } from "./coreCaseLogger.js";

class MemoryLogStream {
    public readonly lines: string[] = [];

    public write(line: string): void {
        this.lines.push(line);
    }
}

void describe("Core Case pino audit logging", () => {
    void test("redacts receipt PII and payment identifiers from success logs", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseAuditLogger(stream, { timestamp: false });
        const rawPaymentId = "pay_synthetic_raw_123456789";

        logger.logExpenseReportAuditSuccess({
            action: "receipt_attached",
            paymentId: rawPaymentId,
            receipt: {
                amount: "142.93",
                email: "employee@example.invalid",
                merchant: "Synthetic Cafe",
            },
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain(rawPaymentId);
        expect(emitted).not.toContain("142.93");
        expect(emitted).not.toContain("employee@example.invalid");
        expect(emitted).toContain("[REDACTED]");
    });

    void test("redacts receipt PII and payment identifiers from error logs", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseAuditLogger(stream, { timestamp: false });
        const rawPaymentId = "synthetic-payment-reference";
        const uuidPaymentReference = "60000000-0000-4000-8000-000000000601";

        logger.logExpenseReportAuditError({
            action: "receipt_processing_failed",
            error: new Error(
                `failed for ${rawPaymentId} employee@example.invalid 87.65`,
            ),
            payment: {
                id: rawPaymentId,
                processorReference: uuidPaymentReference,
            },
            receiptMetadata: {
                amount: "87.65",
                cardholderName: "Synthetic Employee",
            },
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain(rawPaymentId);
        expect(emitted).not.toContain(uuidPaymentReference);
        expect(emitted).not.toContain("87.65");
        expect(emitted).not.toContain("employee@example.invalid");
        expect(emitted).not.toContain("Synthetic Employee");
        expect(emitted).toContain("[REDACTED]");
        expect(emitted).toContain("receipt_processing_failed");
        expect(emitted).not.toContain("failed for");
    });

    void test("redacts nested payment identifiers in payment context objects", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseAuditLogger(stream, { timestamp: false });
        const rawPaymentId = "synthetic-payment-reference";
        const rawPaymentReference = "60000000-0000-4000-8000-000000000602";
        const rawReimbursementReference = "stub-payment-2026-0001";

        logger.logExpenseReportAuditSuccess({
            action: "payment_metadata_checked",
            paymentDetails: {
                id: rawPaymentId,
                reference: rawPaymentReference,
            },
            reimbursement: {
                paymentReferenceId: rawReimbursementReference,
            },
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain(rawPaymentId);
        expect(emitted).not.toContain(rawPaymentReference);
        expect(emitted).not.toContain(rawReimbursementReference);
        expect(emitted).toContain("[REDACTED]");
    });

    void test("redacts flat receipt-derived PII and amount pairs", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseAuditLogger(stream, { timestamp: false });

        logger.logExpenseReportAuditSuccess({
            action: "receipt_metadata_checked",
            amount: "$1,234.56",
            cardholderName: "Synthetic Employee",
        });

        const emitted = stream.lines.join("");

        expect(emitted).not.toContain("$1,234.56");
        expect(emitted).not.toContain("Synthetic Employee");
        expect(emitted).toContain("[REDACTED]");
    });

    void test("keeps non-receipt decimal strings intact", () => {
        const stream = new MemoryLogStream();
        const logger = createCoreCaseAuditLogger(stream, { timestamp: false });

        logger.logExpenseReportAuditSuccess({
            action: "workflow_metric_recorded",
            exchangeRate: "1.23",
            processingDurationSeconds: "12.34",
        });

        const emitted = stream.lines.join("");

        expect(emitted).toContain("1.23");
        expect(emitted).toContain("12.34");
    });
});
