import { randomUUID } from "node:crypto";

export type IssuePaymentStubRequest = {
    tenantId: string;
    expenseReportId: string;
    actorId: string;
    correlationId: string;
};

export type IssuedPaymentStub = {
    paymentId: string;
};

export type CompensatePaymentStubRequest = IssuePaymentStubRequest & {
    paymentId: string;
    reason: string;
};

export type PaymentStubIssuer = {
    issue(request: IssuePaymentStubRequest): Promise<IssuedPaymentStub>;
    compensate(request: CompensatePaymentStubRequest): Promise<void>;
};

/**
 * Issues synthetic payment references until a real payment adapter is available.
 */
export const syntheticPaymentStubIssuer: PaymentStubIssuer = {
    async issue(): Promise<IssuedPaymentStub> {
        return { paymentId: `synthetic-payment-${randomUUID()}` };
    },
    async compensate(): Promise<void> {
        return Promise.resolve();
    },
};
