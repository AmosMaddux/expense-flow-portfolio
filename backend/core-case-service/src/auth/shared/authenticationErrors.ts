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
 * Represents valid primary credentials that require a second factor.
 */
export class MfaRequiredError extends Error {
    public constructor() {
        super("MFA code is required.");
        this.name = "MfaRequiredError";
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

/**
 * Represents an attempt to create a second MFA enrollment for one user.
 */
export class MfaAlreadyEnrolledError extends Error {
    public constructor() {
        super("MFA is already enrolled for this user.");
        this.name = "MfaAlreadyEnrolledError";
    }
}

/**
 * Represents an MFA enrollment row that cannot be used for authentication.
 */
export class InvalidMfaEnrollmentConfigurationError extends Error {
    public constructor() {
        super("MFA enrollment configuration is invalid.");
        this.name = "InvalidMfaEnrollmentConfigurationError";
    }
}
