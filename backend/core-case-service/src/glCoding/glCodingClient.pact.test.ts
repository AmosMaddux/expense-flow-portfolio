import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { Matchers, Pact, SpecificationVersion } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import {
    codeExpenseLineItems,
    type GlCodingRequest,
} from "./glCodingClient.js";

const flaggedLineItemId = "30000000-0000-4000-8000-000000000101";
const unflaggedLineItemId = "30000000-0000-4000-8000-000000000102";
const unmappedLineItemId = "30000000-0000-4000-8000-000000000103";
const mileageEntryId = "30000000-0000-4000-8000-000000000201";
const categoryPattern = "^\\S.{0,99}$";
const pactDirectory =
    process.env.PACT_OUTPUT_DIR ??
    mkdtempSync(resolve(tmpdir(), "expense-flow-pacts-"));
const pactInteractionTimeoutMs = 30_000;

function lineItemRequest(
    lineItemId: string,
    merchant: string,
    amount: string,
    category: GlCodingRequest["line_items"][number]["category"],
): GlCodingRequest {
    return {
        line_items: [
            {
                line_item_id: lineItemId,
                merchant,
                amount,
                currency: "USD",
                category,
            },
        ],
        mileage: [],
    };
}

function lineItemRequestMatcher(request: GlCodingRequest) {
    const lineItem = request.line_items[0];
    if (lineItem === undefined) {
        throw new Error("A line-item Pact request requires one line item.");
    }

    return {
        line_items: Matchers.eachLike(
            {
                line_item_id: Matchers.uuid(lineItem.line_item_id),
                merchant: Matchers.string(lineItem.merchant),
                amount: Matchers.regex("^\\d{1,10}\\.\\d{2}$", lineItem.amount),
                currency: Matchers.regex("^[A-Z]{3}$", lineItem.currency),
                category: Matchers.regex(categoryPattern, lineItem.category),
            },
            1,
        ),
        mileage: [],
    };
}

function codedLineItemMatcher(
    lineItemId: string,
    category: GlCodingRequest["line_items"][number]["category"],
    amount: string,
    mappingStatus: "mapped" | "unmapped",
    glAccount: unknown,
    flaggedLineItem: boolean,
) {
    return Matchers.eachLike(
        {
            source_id: Matchers.uuid(lineItemId),
            source_type: Matchers.equal("line_item"),
            category: Matchers.regex(categoryPattern, category),
            mapping_status: Matchers.equal(mappingStatus),
            gl_account: glAccount,
            amount: Matchers.regex("^\\d{1,10}\\.\\d{2}$", amount),
            currency: Matchers.regex("^[A-Z]{3}$", "USD"),
            flagged_line_item: Matchers.boolean(flaggedLineItem),
        },
        1,
    );
}

describe("Core Case Service GL-coding consumer contract", () => {
    const pact = new Pact({
        consumer: "core-case-service",
        provider: "gl-coding-service",
        dir: pactDirectory,
        logLevel: "error",
        spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
    });

    it(
        "codes a flagged mapped line item",
        async () => {
            const request = lineItemRequest(
                flaggedLineItemId,
                "Synthetic Air",
                "501.00",
                "Travel",
            );

            await pact
                .addInteraction()
                .given("the Travel GL mapping is available")
                .uponReceiving("a request to code a flagged Travel line item")
                .withRequest("POST", "/gl-coding/line-items", (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody(lineItemRequestMatcher(request));
                })
                .willRespondWith(200, (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody({
                            coded_items: codedLineItemMatcher(
                                flaggedLineItemId,
                                "Travel",
                                "501.00",
                                "mapped",
                                {
                                    account_code: Matchers.string("6000"),
                                    account_name:
                                        Matchers.string("Travel Expense"),
                                },
                                true,
                            ),
                            flags: Matchers.eachLike(
                                {
                                    source_id: Matchers.uuid(flaggedLineItemId),
                                    source_type: Matchers.equal("line_item"),
                                    code: Matchers.equal(
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
                        request,
                    );

                    expect(response.coded_items[0]?.flagged_line_item).toBe(
                        true,
                    );
                    expect(response.coded_items[0]?.mapping_status).toBe(
                        "mapped",
                    );
                });
        },
        pactInteractionTimeoutMs,
    );

    it(
        "codes an unflagged mapped line item without flags",
        async () => {
            const request = lineItemRequest(
                unflaggedLineItemId,
                "Synthetic Cafe",
                "42.50",
                "Meals",
            );

            await pact
                .addInteraction()
                .given("the Meals GL mapping is available")
                .uponReceiving("a request to code an unflagged Meals line item")
                .withRequest("POST", "/gl-coding/line-items", (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody(lineItemRequestMatcher(request));
                })
                .willRespondWith(200, (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody({
                            coded_items: codedLineItemMatcher(
                                unflaggedLineItemId,
                                "Meals",
                                "42.50",
                                "mapped",
                                {
                                    account_code: Matchers.string("6100"),
                                    account_name:
                                        Matchers.string("Meals Expense"),
                                },
                                false,
                            ),
                            flags: [],
                        });
                })
                .executeTest(async (mockServer) => {
                    const response = await codeExpenseLineItems(
                        mockServer.url,
                        request,
                    );

                    expect(response.coded_items[0]?.flagged_line_item).toBe(
                        false,
                    );
                    expect(response.flags).toEqual([]);
                });
        },
        pactInteractionTimeoutMs,
    );

    it(
        "returns an explicit unmapped line item",
        async () => {
            const request = lineItemRequest(
                unmappedLineItemId,
                "Synthetic Vendor",
                "25.00",
                "Company Functions",
            );

            await pact
                .addInteraction()
                .given("the Company Functions category has no GL mapping")
                .uponReceiving(
                    "a request to code an unmapped Company Functions line item",
                )
                .withRequest("POST", "/gl-coding/line-items", (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody(lineItemRequestMatcher(request));
                })
                .willRespondWith(200, (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody({
                            coded_items: codedLineItemMatcher(
                                unmappedLineItemId,
                                "Company Functions",
                                "25.00",
                                "unmapped",
                                Matchers.nullValue(),
                                false,
                            ),
                            flags: [],
                        });
                })
                .executeTest(async (mockServer) => {
                    const response = await codeExpenseLineItems(
                        mockServer.url,
                        request,
                    );

                    expect(response.coded_items[0]?.mapping_status).toBe(
                        "unmapped",
                    );
                    expect(response.coded_items[0]?.gl_account).toBeNull();
                });
        },
        pactInteractionTimeoutMs,
    );

    it(
        "codes a positive mileage entry",
        async () => {
            const request: GlCodingRequest = {
                line_items: [],
                mileage: [
                    {
                        mileage_entry_id: mileageEntryId,
                        route: "Office to synthetic client site",
                        distance: "18.50",
                        mileage_date: "2026-07-17",
                    },
                ],
            };

            await pact
                .addInteraction()
                .given("the Mileage GL mapping is available")
                .uponReceiving("a request to code a positive mileage entry")
                .withRequest("POST", "/gl-coding/line-items", (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody({
                            line_items: [],
                            mileage: Matchers.eachLike(
                                {
                                    mileage_entry_id:
                                        Matchers.uuid(mileageEntryId),
                                    route: Matchers.string(
                                        "Office to synthetic client site",
                                    ),
                                    distance: Matchers.regex(
                                        "^(?:[1-9]\\d{0,5}\\.\\d{2}|0\\.(?:0[1-9]|[1-9]\\d))$",
                                        "18.50",
                                    ),
                                    mileage_date: Matchers.date(
                                        "yyyy-MM-dd",
                                        "2026-07-17",
                                    ),
                                },
                                1,
                            ),
                        });
                })
                .willRespondWith(200, (builder) => {
                    builder
                        .headers({ "Content-Type": "application/json" })
                        .jsonBody({
                            coded_items: Matchers.eachLike(
                                {
                                    source_id: Matchers.uuid(mileageEntryId),
                                    source_type: Matchers.equal("mileage"),
                                    category: Matchers.equal("Mileage"),
                                    mapping_status: Matchers.equal("mapped"),
                                    gl_account: {
                                        account_code: Matchers.string("6300"),
                                        account_name:
                                            Matchers.string("Mileage Expense"),
                                    },
                                    flagged_line_item: Matchers.boolean(false),
                                },
                                1,
                            ),
                            flags: [],
                        });
                })
                .executeTest(async (mockServer) => {
                    const response = await codeExpenseLineItems(
                        mockServer.url,
                        request,
                    );

                    expect(response.coded_items[0]?.source_type).toBe(
                        "mileage",
                    );
                    expect(response.coded_items[0]?.flagged_line_item).toBe(
                        false,
                    );
                });
        },
        pactInteractionTimeoutMs,
    );
});
