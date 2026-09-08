import { describe, expect, test } from "vitest";

import {
    isPolicyAssistConfigured,
    loadPolicyAssistConfig,
} from "./policyAssistConfig.js";

void describe("policyAssistConfig", () => {
    void test("loads canonical policy assist API key with defaults", () => {
        const environment: NodeJS.ProcessEnv = {
            POLICY_ASSIST_API_KEY: "synthetic-policy-assist-key",
        };
        const config = loadPolicyAssistConfig(environment);

        expect(config).toMatchObject({
            POLICY_ASSIST_API_KEY: "synthetic-policy-assist-key",
            POLICY_ASSIST_BASE_URL: "https://api.openai.com/v1",
            POLICY_ASSIST_MODEL: "gpt-4o-mini",
            POLICY_ASSIST_TIMEOUT_MS: 30_000,
            POLICY_ASSIST_MAX_RETRIES: 1,
        });
    });

    void test("does not treat legacy OpenAI aliases as configured", () => {
        const environment = {
            OPENAI_API_KEY: "synthetic-legacy-key",
        } as NodeJS.ProcessEnv;

        expect(isPolicyAssistConfigured(environment)).toBe(false);
        expect(() => loadPolicyAssistConfig(environment)).toThrow(
            /POLICY_ASSIST_API_KEY/u,
        );
    });
});
