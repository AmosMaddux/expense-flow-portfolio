import { describe, expect, test } from "vitest";

import { resolveLoginTenantId } from "./loginTenant";

const primaryTenantId = "10000000-0000-4000-8000-000000000001";
const secondaryTenantId = "20000000-0000-4000-8000-000000000002";

describe("login tenant resolution", () => {
    test("keeps example1 identities in the primary tenant", () => {
        expect(
            resolveLoginTenantId(
                "employee@example1.invalid",
                primaryTenantId,
                secondaryTenantId,
            ),
        ).toBe(primaryTenantId);
    });

    test("routes every example2 role identity to the secondary tenant", () => {
        for (const email of [
            "employee@example2.invalid",
            "employee2@example2.invalid",
            "manager@example2.invalid",
            "finance-admin@example2.invalid",
            "platform-admin@example2.invalid",
        ]) {
            expect(
                resolveLoginTenantId(email, primaryTenantId, secondaryTenantId),
            ).toBe(secondaryTenantId);
        }
    });

    test("does not reroute sign-in when no secondary tenant is configured", () => {
        expect(
            resolveLoginTenantId("employee@example2.invalid", primaryTenantId),
        ).toBe(primaryTenantId);
    });
});
