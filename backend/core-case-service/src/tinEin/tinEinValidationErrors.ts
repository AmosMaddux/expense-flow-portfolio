/**
 * Represents a failed or contract-invalid call to the shared TIN/EIN service.
 */
export class TinEinValidationServiceError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "TinEinValidationServiceError";
    }
}

/**
 * Represents a transport, timeout, or circuit-breaker failure reaching TIN/EIN validation.
 */
export class TinEinValidationUnavailableError extends TinEinValidationServiceError {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "TinEinValidationUnavailableError";
    }
}
