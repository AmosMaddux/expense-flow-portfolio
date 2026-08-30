import { describe, expect, test } from "vitest";

import {
    isPolicyAssistConfigured,
    loadPolicyAssistConfig,
} from "./policyAssistConfig.js";

void describe("policy assist config", () => {
    void test("accepts the OpenAPIKey environment alias", () => {
        const config = loadPolicyAssistConfig({
            OpenAPIKey: "synthetic-openai-key",
        });

        expect(config.apiKey).toBe("synthetic-openai-key");
        expect(config.baseUrl).toBe("https://api.openai.com/v1");
        expect(config.model).toBe("gpt-4o-mini");
        expect(isPolicyAssistConfigured({ OpenAPIKey: "synthetic-openai-key" }))
            .toBe(true);
    });
});
