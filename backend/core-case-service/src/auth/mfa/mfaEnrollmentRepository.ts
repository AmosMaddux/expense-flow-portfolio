import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { mfaEnrollment, type NewMfaEnrollment } from "../../db/schema/index.js";
import type {
    MfaEnrollmentRepository,
    StoredMfaEnrollment,
} from "./mfaEnrollmentService.js";
import * as schema from "../../db/schema/index.js";
import { MfaAlreadyEnrolledError } from "../shared/authenticationErrors.js";

export type MfaEnrollmentDatabase = NodePgDatabase<typeof schema>;

type PostgresError = {
    code?: string;
    constraint?: string;
    cause?: unknown;
};

const uniqueViolationCode = "23505";
const mfaEnrollmentTenantUserConstraint =
    "mfa_enrollment_tenant_user_unique_idx";

/**
 * Creates a Drizzle-backed repository for MFA enrollment records.
 */
export function createDrizzleMfaEnrollmentRepository(
    db: MfaEnrollmentDatabase,
): MfaEnrollmentRepository {
    return {
        async create(enrollment: StoredMfaEnrollment): Promise<void> {
            const enrollmentRow: NewMfaEnrollment = {
                tenantId: enrollment.tenantId,
                userId: enrollment.userId,
                secretCiphertext: enrollment.secretCiphertext,
                secretIv: enrollment.secretIv,
                secretAuthTag: enrollment.secretAuthTag,
                secretKeyVersion: enrollment.secretKeyVersion,
                algorithm: enrollment.algorithm,
                digits: enrollment.digits,
                periodSeconds: enrollment.periodSeconds,
            };

            try {
                await db.insert(mfaEnrollment).values(enrollmentRow);
            } catch (error) {
                if (isDuplicateMfaEnrollmentError(error)) {
                    throw new MfaAlreadyEnrolledError();
                }

                throw error;
            }
        },
    };
}

function isDuplicateMfaEnrollmentError(error: unknown): boolean {
    const visitedErrors = new Set<object>();
    let currentError = error;

    while (
        currentError !== null &&
        typeof currentError === "object" &&
        !visitedErrors.has(currentError)
    ) {
        visitedErrors.add(currentError);
        const postgresError = currentError as PostgresError;

        if (
            postgresError.code === uniqueViolationCode &&
            postgresError.constraint === mfaEnrollmentTenantUserConstraint
        ) {
            return true;
        }

        // Drizzle wraps driver errors; follow the cause chain without exposing database details.
        currentError = postgresError.cause;
    }

    return false;
}
