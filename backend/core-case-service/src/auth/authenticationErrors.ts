/**
 * Represents a generic primary credential authentication failure.
 */
export class InvalidCredentialsError extends Error {
    public constructor() {
        super("Invalid email or password.");
        this.name = "InvalidCredentialsError";
    }
}

/**
 * Represents a generic second-factor authentication failure.
 */
export class InvalidMfaCodeError extends Error {
    public constructor() {
        super("Invalid or expired MFA code.");
        this.name = "InvalidMfaCodeError";
    }
}
