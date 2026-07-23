import { createHmac } from "node:crypto";

import { base32 } from "rfc4648";

/**
 * Generates the current RFC 6238 code for a synthetic local TOTP enrollment.
 */
export function generateLocalTotpCode(
    encodedSecret: string,
    digits: 6 | 8,
    periodSeconds: number,
    now: Date = new Date(),
): string {
    const counter = Math.floor(now.getTime() / 1000 / periodSeconds);
    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(BigInt(counter));

    const digest = createHmac(
        "sha1",
        Buffer.from(base32.parse(encodedSecret, { loose: true })),
    )
        .update(counterBytes)
        .digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const binaryCode = digest.readUInt32BE(offset) & 0x7fffffff;

    return (binaryCode % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * Returns the whole seconds remaining in the active TOTP interval.
 */
export function getLocalTotpSecondsRemaining(
    periodSeconds: number,
    now: Date = new Date(),
): number {
    const elapsedSeconds = Math.floor(now.getTime() / 1000);

    return periodSeconds - (elapsedSeconds % periodSeconds);
}
