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
    if (error === null || typeof error !== "object") {
        return false;
    }

    const postgresError = error as PostgresError;

    return (
        postgresError.code === uniqueViolationCode &&
        postgresError.constraint === mfaEnrollmentTenantUserConstraint
    );
}
