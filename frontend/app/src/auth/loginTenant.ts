const secondarySyntheticTenantDomain = "example2.invalid";

/**
 * Selects the configured tenant for local synthetic sign-in identities.
 */
export function resolveLoginTenantId(
    email: string,
    primaryTenantId: string,
    secondaryTenantId?: string,
): string {
    const normalizedDomain = email.trim().toLowerCase().split("@")[1];

    if (
        secondaryTenantId !== undefined &&
        secondaryTenantId.length > 0 &&
        normalizedDomain === secondarySyntheticTenantDomain
    ) {
        return secondaryTenantId;
    }

    return primaryTenantId;
}
