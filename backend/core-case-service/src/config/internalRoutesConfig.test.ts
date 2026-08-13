import { describe, expect, test } from "vitest";

import { loadInternalRoutesConfig } from "./internalRoutesConfig.js";

void describe("internal routes configuration", () => {
    void test("keeps internal command routes disabled by default", () => {
        expect(loadInternalRoutesConfig({})).toStrictEqual({
            enabled: false,
        });
    });

    void test("requires an explicit true value before enabling internal routes", () => {
        expect(
            loadInternalRoutesConfig({
                CORE_CASE_INTERNAL_ROUTES_ENABLED: "true",
            }),
        ).toStrictEqual({
            enabled: true,
        });
        expect(
            loadInternalRoutesConfig({
                CORE_CASE_INTERNAL_ROUTES_ENABLED: "false",
            }),
        ).toStrictEqual({
            enabled: false,
        });
    });

    void test("rejects ambiguous internal route enablement values", () => {
        expect(() =>
            loadInternalRoutesConfig({
                CORE_CASE_INTERNAL_ROUTES_ENABLED: "yes",
            }),
        ).toThrow();
    });
});
