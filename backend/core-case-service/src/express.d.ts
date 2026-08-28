import type { Span } from "@opentelemetry/api";

declare module "express-serve-static-core" {
    interface Request {
        tracing?: {
            correlationId?: string;
            span: Span;
            traceHeader: string;
        };
    }
}
