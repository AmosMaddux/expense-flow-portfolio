/**
 * Represents a failed or contract-invalid call to the policy embedding provider.
 */
export class PolicyEmbeddingServiceError extends Error {
    public constructor(
        message: string,
        public readonly statusCode?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "PolicyEmbeddingServiceError";
    }
}
