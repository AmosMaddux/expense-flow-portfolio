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
 * Represents an attempt to create a second MFA enrollment for one user.
 */
export class MfaAlreadyEnrolledError extends Error {
    public constructor() {
        super("MFA is already enrolled for this user.");
        this.name = "MfaAlreadyEnrolledError";
    }
}
