import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { mfaEnrollment, type NewMfaEnrollment } from "../db/schema/index.js";
import type {
    MfaEnrollmentRepository,
    StoredMfaEnrollment,
} from "./mfaEnrollmentService.js";
import * as schema from "../db/schema/index.js";

export type MfaEnrollmentDatabase = NodePgDatabase<typeof schema>;

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

            await db.insert(mfaEnrollment).values(enrollmentRow);
        },
    };
}
