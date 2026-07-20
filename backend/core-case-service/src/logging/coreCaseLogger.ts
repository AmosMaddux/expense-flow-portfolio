import pino, {
    type DestinationStream,
    type Logger,
    type LoggerOptions,
} from "pino";

const redactedValue = "[REDACTED]";

const paymentIdentifierKeyPattern =
    /^(payment(Id|Identifier|Reference)?|payment.*(id|identifier|reference)|paymentReference|paymentIdentifier|paymentId)$/i;
const paymentContextKeyPattern = /(payment|reimbursement)/i;
const paymentContextIdentifierKeyPattern = /^(id|identifier|reference)$/i;
const receiptContextKeyPattern = /receipt/i;
const receiptPersonalDataKeyPattern =
    /^(cardholderName|customerName|email|employeeEmail|fullName|name|owner|personalName|receiptEmail|receiptName)$/i;
const receiptAmountKeyPattern = /^(amount|subtotal|tax|tip|total)$/i;
const emailAddressPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

type CoreCasePinoLogger = Pick<Logger, "error" | "info">;

export type CoreCaseAuditLogger = {
    logExpenseReportAuditError: (event: Record<string, unknown>) => void;
    logExpenseReportAuditSuccess: (event: Record<string, unknown>) => void;
};

function createCoreCasePinoLogger(
    destination?: DestinationStream,
    options: LoggerOptions = {},
): CoreCasePinoLogger {
    return pino(
        {
            ...options,
            base: null,
            level: process.env.CORE_CASE_LOG_LEVEL ?? "info",
            redact: {
                censor: redactedValue,
                paths: [
                    "paymentId",
                    "paymentIdentifier",
                    "paymentReference",
                    "payment.id",
                    "payment.identifier",
                    "payment.reference",
                    "receipt.amount",
                    "receipt.email",
                    "receipt.name",
                    "receipt.owner",
                ],
            },
        },
        destination,
    );
}

/**
 * Creates a safe Core Case audit logger that sanitizes payloads before writing.
 */
export function createCoreCaseAuditLogger(
    destination?: DestinationStream,
    options: LoggerOptions = {},
): CoreCaseAuditLogger {
    const logger = createCoreCasePinoLogger(destination, options);

    return {
        logExpenseReportAuditError(event) {
            logger.error(
                sanitizeLogPayload(event),
                "Expense Report audit event failed",
            );
        },
        logExpenseReportAuditSuccess(event) {
            logger.info(
                sanitizeLogPayload(event),
                "Expense Report audit event",
            );
        },
    };
}

const coreCaseAuditLogger = createCoreCaseAuditLogger();

/**
 * Logs successful Expense Report audit activity without exposing receipt or payment data.
 */
export function logExpenseReportAuditSuccess(
    event: Record<string, unknown>,
): void {
    coreCaseAuditLogger.logExpenseReportAuditSuccess(event);
}

/**
 * Logs failed Expense Report audit activity without exposing receipt or payment data.
 */
export function logExpenseReportAuditError(
    event: Record<string, unknown>,
): void {
    coreCaseAuditLogger.logExpenseReportAuditError(event);
}

/**
 * Returns a copy of a log payload with receipt PII and payment identifiers removed.
 */
export function sanitizeLogPayload(value: unknown): unknown {
    return sanitizeValue(value, false, false);
}

function sanitizeValue(
    value: unknown,
    receiptContext: boolean,
    paymentContext: boolean,
): unknown {
    if (Array.isArray(value)) {
        return value.map((item) =>
            sanitizeValue(item, receiptContext, paymentContext),
        );
    }

    if (value instanceof Date) {
        return value;
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactedValue,
        };
    }

    if (typeof value === "string") {
        return paymentContext ? redactedValue : sanitizeString(value);
    }

    if (value === null || typeof value !== "object") {
        return value;
    }

    const source = value as Record<string, unknown>;
    const hasReceiptPersonalData = Object.keys(source).some((key) =>
        receiptPersonalDataKeyPattern.test(key),
    );

    return Object.fromEntries(
        Object.entries(source).map(([key, nestedValue]) => {
            const nestedReceiptContext =
                receiptContext ||
                hasReceiptPersonalData ||
                receiptContextKeyPattern.test(key);
            const nestedPaymentContext =
                paymentContext || paymentContextKeyPattern.test(key);

            if (
                paymentIdentifierKeyPattern.test(key) ||
                (nestedPaymentContext &&
                    paymentContextIdentifierKeyPattern.test(key))
            ) {
                return [key, redactedValue];
            }

            if (
                nestedReceiptContext &&
                (receiptPersonalDataKeyPattern.test(key) ||
                    receiptAmountKeyPattern.test(key))
            ) {
                return [key, redactedValue];
            }

            return [
                key,
                sanitizeValue(
                    nestedValue,
                    nestedReceiptContext,
                    nestedPaymentContext,
                ),
            ];
        }),
    );
}

function sanitizeString(value: string): string {
    return value.replace(emailAddressPattern, redactedValue);
}
