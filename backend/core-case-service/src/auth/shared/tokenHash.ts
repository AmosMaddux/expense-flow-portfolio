import { createHash } from "node:crypto";

/**
 * Hashes bearer-style tokens before persistence or lookup.
 */
export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
}
