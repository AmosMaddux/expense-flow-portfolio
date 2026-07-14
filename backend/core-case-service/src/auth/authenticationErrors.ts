/**
 * Represents a generic primary credential authentication failure.
 */
export class InvalidCredentialsError extends Error {
    public constructor() {
        super("Invalid email or password.");
        this.name = "InvalidCredentialsError";
    }
}
