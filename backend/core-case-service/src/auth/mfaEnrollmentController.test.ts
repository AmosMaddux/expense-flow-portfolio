import type { NextFunction, Request, Response } from "express";
import { describe, expect, test, vi } from "vitest";

import { MfaAlreadyEnrolledError } from "./authenticationErrors.js";
import { createPostMfaEnrollment } from "./mfaEnrollmentController.js";
import type { MfaEnrollmentService } from "./mfaEnrollmentService.js";

type TestResponse = Response & {
    statusMock: ReturnType<typeof vi.fn>;
    jsonMock: ReturnType<typeof vi.fn>;
};

function createResponse(): TestResponse {
    const response = {} as TestResponse;
    const statusMock = vi.fn(() => response);
    const jsonMock = vi.fn(() => response);

    response.statusMock = statusMock;
    response.jsonMock = jsonMock;
    response.status = statusMock;
    response.json = jsonMock;

    return response;
}

void describe("MFA enrollment controller", () => {
    void test("returns a provisioning URI after enrollment succeeds", async () => {
        const enrollMock = vi.fn(() =>
            Promise.resolve({
                provisioningUri:
                    "otpauth://totp/ExpenseFlow:employee%40example.invalid?secret=SYNTHETIC",
            }),
        );
        const service: MfaEnrollmentService = {
            enroll: enrollMock,
        };
        const handler = createPostMfaEnrollment(service);
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId: "00000000-0000-4000-8000-000000000801",
                userId: "10000000-0000-4000-8000-000000000801",
                email: "employee@example.invalid",
            },
        } as Request;

        await handler(request, response, next);

        expect(enrollMock).toHaveBeenCalledWith(request.body);
        expect(response.statusMock).toHaveBeenCalledWith(201);
        expect(response.jsonMock).toHaveBeenCalledWith({
            provisioningUri:
                "otpauth://totp/ExpenseFlow:employee%40example.invalid?secret=SYNTHETIC",
        });
        expect(next).not.toHaveBeenCalled();
    });

    void test("passes malformed request bodies to the problem-json handler", async () => {
        const enrollMock = vi.fn();
        const service: MfaEnrollmentService = {
            enroll: enrollMock,
        };
        const handler = createPostMfaEnrollment(service);
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId: "not-a-uuid",
                userId: "10000000-0000-4000-8000-000000000802",
                email: "employee@example.invalid",
            },
        } as Request;

        await handler(request, response, next);

        expect(enrollMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
    });

    void test("returns 409 when the user already has an MFA enrollment", async () => {
        const service: MfaEnrollmentService = {
            enroll: vi.fn(() => Promise.reject(new MfaAlreadyEnrolledError())),
        };
        const handler = createPostMfaEnrollment(service);
        const response = createResponse();
        const next = vi.fn() as NextFunction;
        const request = {
            body: {
                tenantId: "00000000-0000-4000-8000-000000000803",
                userId: "10000000-0000-4000-8000-000000000803",
                email: "employee@example.invalid",
            },
        } as Request;

        await handler(request, response, next);

        expect(response.statusMock).toHaveBeenCalledWith(409);
        expect(response.jsonMock).toHaveBeenCalledWith({
            message: "MFA is already enrolled for this user.",
        });
        expect(next).not.toHaveBeenCalled();
    });
});
