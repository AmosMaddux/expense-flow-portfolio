import type { ErrorRequestHandler, NextFunction, Request } from "express";
import { ZodError } from "zod";
import { logCoreCaseError } from "../logging/coreCaseLogger.js";

type ProblemJsonBody = {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
};

/**
 * Represents a missing Core Case Service resource.
 */
export class NotFoundError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "NotFoundError";
    }
}

/**
 * Represents a request that lacks valid authentication credentials.
 */
export class UnauthorizedError extends Error {
    public constructor(message = "A valid access token is required.") {
        super(message);
        this.name = "UnauthorizedError";
    }
}

/**
 * Represents an authenticated request that is not permitted to perform an action.
 */
export class ForbiddenError extends Error {
    public constructor(message = "This action is not permitted.") {
        super(message);
        this.name = "ForbiddenError";
    }
}

/**
 * Represents an authenticated tenant exceeding its configured request limit.
 */
export class RateLimitExceededError extends Error {
    public constructor(public readonly retryAfterSeconds: number) {
        super(
            "The tenant request limit was exceeded. Retry after the indicated delay.",
        );
        this.name = "RateLimitExceededError";
    }
}

/**
 * Represents a request that conflicts with another in-flight operation.
 */
export class ConflictError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ConflictError";
    }
}

/**
 * Represents a downstream service failure needed to complete a request.
 */
export class BadGatewayError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "BadGatewayError";
    }
}

/**
 * Represents invalid server-side configuration.
 */
export class ConfigurationError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ConfigurationError";
    }
}

/**
 * Converts thrown application errors into RFC 9457 Problem+JSON responses.
 */
export const problemJsonErrorHandler: ErrorRequestHandler = (
    error: unknown,
    req: Request,
    res,
    next: NextFunction,
) => {
    if (res.headersSent) {
        next(error);
        return;
    }

    const problem = toProblemJson(error, req.originalUrl);

    if (error instanceof RateLimitExceededError) {
        res.set("Retry-After", String(error.retryAfterSeconds));
    }

    if (problem.status >= 500) {
        logCoreCaseError({
            eventType: "unhandled_error",
            instance: req.originalUrl,
            outcome: "error",
            route: req.originalUrl,
            service: "core-case-service",
            statusCode: problem.status,
        });
    }

    res.status(problem.status).type("application/problem+json").json(problem);
};

function toProblemJson(error: unknown, instance: string): ProblemJsonBody {
    if (error instanceof ZodError) {
        return {
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: formatZodErrorDetail(error),
            instance,
        };
    }

    if (error instanceof NotFoundError) {
        return {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            detail: error.message,
            instance,
        };
    }

    if (error instanceof UnauthorizedError) {
        return {
            type: "about:blank",
            title: "Unauthorized",
            status: 401,
            detail: error.message,
            instance,
        };
    }

    if (error instanceof ForbiddenError) {
        return {
            type: "about:blank",
            title: "Forbidden",
            status: 403,
            detail: error.message,
            instance,
        };
    }

    if (error instanceof RateLimitExceededError) {
        return {
            type: "about:blank",
            title: "Too Many Requests",
            status: 429,
            detail: error.message,
            instance,
        };
    }

    if (error instanceof ConflictError) {
        return {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: error.message,
            instance,
        };
    }

    if (error instanceof BadGatewayError) {
        return {
            type: "about:blank",
            title: "Bad Gateway",
            status: 502,
            detail: error.message,
            instance,
        };
    }

    if (error instanceof ConfigurationError) {
        return {
            type: "about:blank",
            title: "Internal Server Error",
            status: 500,
            detail: error.message,
            instance,
        };
    }

    // New Check: Catch malformed JSON/body-parser syntax errors
    if (
        error instanceof SyntaxError &&
        "status" in error &&
        error.status === 400 &&
        "body" in error
    ) {
        return {
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: "Invalid JSON payload format. Please check your syntax.",
            instance,
        };
    }

    // Alternate structural check if you prefer checking body-parser's explicit error type property
    if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.parse.failed"
    ) {
        return {
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: "Malformed JSON body could not be parsed.",
            instance,
        };
    }

    if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
    ) {
        return {
            type: "about:blank",
            title: "Payload Too Large",
            status: 413,
            detail: "Receipt files must be 10 MB or smaller.",
            instance,
        };
    }

    return {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "An unexpected error occurred.",
        instance,
    };
}

function formatZodErrorDetail(error: ZodError): string {
    return error.issues
        .map((issue) => {
            const fieldPath = issue.path.join(".");
            const field = fieldPath.length > 0 ? fieldPath : "body";

            return `${field}: ${issue.message}`;
        })
        .join("; ");
}
