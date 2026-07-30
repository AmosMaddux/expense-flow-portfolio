/**
 * Represents a failed or contract-invalid call to the shared TIN/EIN service.
 */
export class TinEinValidationServiceError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "TinEinValidationServiceError";
    }
}
