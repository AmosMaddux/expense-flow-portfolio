export type PolicyAssistFailureKind =
    "timeout" | "network" | "provider_rejected" | "invalid_response";

/**
 * Represents a failed or contract-invalid call to the policy assist model.
 */
export class PolicyAssistServiceError extends Error {
    public constructor(
        message: string,
        public readonly kind: PolicyAssistFailureKind,
        public readonly statusCode?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "PolicyAssistServiceError";
    }
}
