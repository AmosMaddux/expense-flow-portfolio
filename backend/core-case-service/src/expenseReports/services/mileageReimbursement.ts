const unsignedDecimalPattern = /^(\d+)(?:\.(\d+))?$/;

/**
 * Calculates a mileage reimbursement with exact decimal multiplication and
 * half-up rounding to currency cents.
 */
export function calculateMileageReimbursement(
    distance: string,
    ratePerMile: string,
): number {
    const distanceDecimal = parseUnsignedDecimal(distance);
    const rateDecimal = parseUnsignedDecimal(ratePerMile);
    const product = distanceDecimal.units * rateDecimal.units;
    const productScale = distanceDecimal.scale + rateDecimal.scale;
    const cents =
        productScale <= 2
            ? product * 10n ** BigInt(2 - productScale)
            : roundHalfUp(product, 10n ** BigInt(productScale - 2));

    return Number(cents) / 100;
}

function parseUnsignedDecimal(value: string): {
    units: bigint;
    scale: number;
} {
    const match = unsignedDecimalPattern.exec(value);
    if (match === null) {
        throw new Error("Mileage values must be unsigned decimal strings.");
    }

    const fraction = match[2] ?? "";

    return {
        units: BigInt(`${match[1]}${fraction}`),
        scale: fraction.length,
    };
}

function roundHalfUp(value: bigint, divisor: bigint): bigint {
    const quotient = value / divisor;
    const remainder = value % divisor;

    return remainder * 2n >= divisor ? quotient + 1n : quotient;
}
