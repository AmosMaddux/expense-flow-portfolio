/**
 * Represents a failed or contract-invalid call to the GL-coding service.
 */
export class GlCodingServiceError extends Error {
    public constructor(
        message: string,
        public readonly statusCode?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "GlCodingServiceError";
    }
}
