import { describe, expect, test, vi } from "vitest";

import {
    createMfaEnrollmentService,
    encodeBase32,
    type MfaEnrollmentRepository,
    type StoredMfaEnrollment,
} from "./mfaEnrollmentService.js";
import type {
    ProtectedTotpSecret,
    TotpSecretProtector,
} from "./totpSecretProtector.js";

const tenantId = "00000000-0000-4000-8000-000000000701";
const userId = "10000000-0000-4000-8000-000000000701";

function createRepository(): MfaEnrollmentRepository & {
    enrollments: StoredMfaEnrollment[];
    createMock: ReturnType<typeof vi.fn>;
} {
    const enrollments: StoredMfaEnrollment[] = [];
    const createMock = vi.fn((enrollment: StoredMfaEnrollment) => {
        enrollments.push(enrollment);
        return Promise.resolve();
    });

    return {
        enrollments,
        create: createMock,
        createMock,
    };
}

function createProtector(): TotpSecretProtector & {
    protectedSecrets: string[];
} {
    const protectedSecrets: string[] = [];

    return {
        protectedSecrets,
        protect(secret): ProtectedTotpSecret {
            protectedSecrets.push(Buffer.from(secret).toString("utf8"));

            return {
                secretCiphertext: "synthetic-ciphertext",
                secretIv: "synthetic-iv",
                secretAuthTag: "synthetic-auth-tag",
                secretKeyVersion: "synthetic-key-v1",
            };
        },
        reveal(): Buffer {
            throw new Error("Not needed for enrollment service tests.");
        },
    };
}

void describe("MFA enrollment service", () => {
    void test.each([
        ["", ""],
        ["f", "MY"],
        ["fo", "MZXQ"],
        ["foo", "MZXW6"],
        ["foob", "MZXW6YQ"],
        ["fooba", "MZXW6YTB"],
        ["foobar", "MZXW6YTBOI"],
    ])("encodes %s with the RFC 4648 base32 vector", (input, expected) => {
        expect(encodeBase32(Buffer.from(input, "ascii"))).toBe(expected);
    });

    void test("provisions a TOTP URI and persists only protected secret fields", async () => {
        const repository = createRepository();
        const protector = createProtector();
        const service = createMfaEnrollmentService(repository, protector);

        const result = await service.enroll({
            tenantId,
            userId,
            email: "Employee@Example.Invalid",
        });

        const provisioningUri = new URL(result.provisioningUri);
        const secret = provisioningUri.searchParams.get("secret");

        expect(result.provisioningUri).toMatch(
            /^otpauth:\/\/totp\/ExpenseFlow:employee%40example.invalid\?/,
        );
        expect(provisioningUri.searchParams.get("issuer")).toBe("ExpenseFlow");
        expect(provisioningUri.searchParams.get("algorithm")).toBe("SHA1");
        expect(provisioningUri.searchParams.get("digits")).toBe("6");
        expect(provisioningUri.searchParams.get("period")).toBe("30");
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(protector.protectedSecrets).toEqual([secret]);
        expect(repository.enrollments).toEqual([
            {
                tenantId,
                userId,
                secretCiphertext: "synthetic-ciphertext",
                secretIv: "synthetic-iv",
                secretAuthTag: "synthetic-auth-tag",
                secretKeyVersion: "synthetic-key-v1",
                algorithm: "SHA1",
                digits: 6,
                periodSeconds: 30,
            },
        ]);
    });
});
