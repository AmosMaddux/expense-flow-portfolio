import { fileURLToPath } from "node:url";

import { Matchers, Pact, SpecificationVersion } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import {
    codeExpenseLineItems,
    type GlCodingRequest,
} from "./glCodingClient.js";

const lineItemId = "30000000-0000-4000-8000-000000000101";
const pactDirectory = fileURLToPath(
    new URL("../../../../pacts", import.meta.url),
);

const glCodingRequest: GlCodingRequest = {
    line_items: [
        {
            line_item_id: lineItemId,
            merchant: "Synthetic Air",
            amount: "501.00",
            currency: "USD",
            category: "Travel",
        },
    ],
    mileage: [],
};

describe("Core Case Service GL-coding consumer contract", () => {
    const pact = new Pact({
        consumer: "core-case-service",
        provider: "gl-coding-service",
        dir: pactDirectory,
        logLevel: "error",
        spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
    });

    it("codes a flagged expense line item", async () => {
        await pact
            .addInteraction()
            .given("the Travel GL mapping is available")
            .uponReceiving("a request to code a flagged Travel line item")
            .withRequest("POST", "/gl-coding/line-items", (builder) => {
                builder
                    .headers({ "Content-Type": "application/json" })
                    .jsonBody({
                        line_items: Matchers.eachLike(
                            {
                                line_item_id: Matchers.uuid(lineItemId),
                                merchant: Matchers.string("Synthetic Air"),
                                amount: Matchers.regex(
                                    "^\\d{1,10}\\.\\d{2}$",
                                    "501.00",
                                ),
                                currency: Matchers.regex("^[A-Z]{3}$", "USD"),
                                category: Matchers.string("Travel"),
                            },
                            1,
                        ),
                        mileage: [],
                    });
            })
            .willRespondWith(200, (builder) => {
                builder
                    .headers({ "Content-Type": "application/json" })
                    .jsonBody({
                        coded_items: Matchers.eachLike(
                            {
                                source_id: Matchers.uuid(lineItemId),
                                source_type: Matchers.string("line_item"),
                                category: Matchers.string("Travel"),
                                gl_account: {
                                    account_code: Matchers.string("6100"),
                                    account_name:
                                        Matchers.string("Travel Expense"),
                                },
                                amount: Matchers.regex(
                                    "^\\d{1,10}\\.\\d{2}$",
                                    "501.00",
                                ),
                                currency: Matchers.regex("^[A-Z]{3}$", "USD"),
                                flagged_line_item: Matchers.boolean(true),
                            },
                            1,
                        ),
                        flags: Matchers.eachLike(
                            {
                                source_id: Matchers.uuid(lineItemId),
                                source_type: Matchers.string("line_item"),
                                code: Matchers.string(
                                    "line_item_over_threshold",
                                ),
                                message: Matchers.string(
                                    "Line item amount is above the MVP manual review threshold.",
                                ),
                            },
                            1,
                        ),
                    });
            })
            .executeTest(async (mockServer) => {
                const response = await codeExpenseLineItems(
                    mockServer.url,
                    glCodingRequest,
                );

                expect(response.coded_items[0]?.flagged_line_item).toBe(true);
                expect(response.coded_items[0]?.gl_account?.account_code).toBe(
                    "6100",
                );
            });
    });
});
