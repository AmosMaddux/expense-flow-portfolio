import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";

import type { NewExpenseReport } from "../../db/schema/expenseReport.js";
import type { GlCodingResponse } from "../../glCoding/glCodingClient.js";
import {
    auditEntry,
    expenseReport,
    glCodingResult,
    lineItem,
    mileageEntry,
    stageTransition,
} from "../../db/schema/index.js";
import { getCoreCaseTestDatabaseUrl } from "../../testSupport/coreCaseTestDatabase.js";

vi.mock("../../db/client.js", () => {
    const client = new Pool({
        connectionString: getCoreCaseTestDatabaseUrl(),
    });
    const db = drizzle(client);
    return {
        db,
    };
});

import { db } from "../../db/client.js";
import {
    buildSubmissionSourceFingerprint,
    buildSubmissionSourceKeys,
    findExpenseReportById,
    insertDraftExpenseReport,
    submitDraftExpenseReport,
} from "./expenseReportRepository.js";

void describe("expenseReportRepository", () => {
    function buildNewExpenseReport(
        tenantId?: string,
        ownerId?: string,
    ): NewExpenseReport {
        return {
            tenantId: tenantId ?? "00000000-0000-0000-0000-000000000083",
            owner: ownerId ?? "20000000-0000-0000-0000-000000000083",
            dueDate: "2026-07-02",
        };
    }

    void test("inserts a Drafted Expense Report", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000183";

        const newReport = buildNewExpenseReport(targetTenantId);

        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        expect(report).toBeDefined();
        expect(report?.tenantId).toEqual(targetTenantId);
        expect(report?.currentStage).toEqual("Drafted");
        expect(report?.id).not.toBeUndefined();
    });

    void test("writes creation audit and initial stage transition", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000184";

        const newReport = buildNewExpenseReport(targetTenantId);

        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, report.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, report.id));

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            tenantId: targetTenantId,
            expenseReportId: report.id,
            actorId: report.owner,
            action: "report_created",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Drafted",
            denialReason: null,
        });
        expect(transitionRows).toHaveLength(1);
        expect(transitionRows[0]).toMatchObject({
            tenantId: targetTenantId,
            expenseReportId: report.id,
            actor: report.owner,
            fromStage: "Drafted",
            toStage: "Drafted",
            reason: "report_created",
        });
    });

    void test("rejects mismatched tenant inserts", async () => {
        const reportTenantId = "00000000-0000-4000-8000-000000000185";
        const sessionTenantId = "00000000-0000-4000-8000-000000000195";

        const newReport = buildNewExpenseReport(reportTenantId);

        const report = await insertDraftExpenseReport(
            sessionTenantId,
            newReport,
        );

        expect(report).toBeUndefined();

        const reports = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.tenantId, reportTenantId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.tenantId, reportTenantId));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.tenantId, reportTenantId));

        expect(reports).toHaveLength(0);
        expect(auditRows).toHaveLength(0);
        expect(transitionRows).toHaveLength(0);
    });

    void test("finds an Expense Report by id", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000186";
        const targetId = "10000000-0000-4000-8000-000000000186";

        const newReport = buildNewExpenseReport(targetTenantId);
        newReport.id = targetId;

        const insertedReport = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );
        expect(insertedReport).toBeDefined();

        const foundReport = await findExpenseReportById(
            targetTenantId,
            targetId,
        );

        expect(foundReport?.id).toEqual(targetId);
        expect(foundReport?.tenantId).toEqual(targetTenantId);
    });

    void test("returns undefined when an Expense Report is absent", async () => {
        const targetId = "10000000-0000-4000-8000-000000000187";

        const foundReport = await findExpenseReportById(
            "00000000-0000-4000-8000-000000000187",
            targetId,
        );

        expect(foundReport).toBeUndefined();
    });

    void test("does not find a saved Expense Report for another tenant", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000188";
        const targetId = "10000000-0000-4000-8000-000000000188";

        const newReport = buildNewExpenseReport(targetTenantId);
        newReport.id = targetId;

        const insertedReport = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );
        expect(insertedReport).toBeDefined();

        const foundReport = await findExpenseReportById(
            "00000000-0000-4000-8000-000000000189",
            targetId,
        );

        expect(foundReport).toBeUndefined();
    });

    void test("submits a Drafted report with appended GL coding history", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000190";
        const ownerId = "20000000-0000-4000-8000-000000000190";
        const actorId = "20000000-0000-4000-8000-000000000191";
        const submissionId = "90000000-0000-4000-8000-000000000190";
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId, ownerId),
            ownerId,
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const insertedLineItems = await db
            .insert(lineItem)
            .values({
                id: "30000000-0000-4000-8000-000000000190",
                tenantId,
                expenseReportId: report.id,
                merchant: "Synthetic Air",
                amount: "501.00",
                currency: "USD",
                category: "Travel",
            })
            .returning();
        const insertedMileageEntries = await db
            .insert(mileageEntry)
            .values({
                id: "30000000-0000-4000-8000-000000000191",
                tenantId,
                expenseReportId: report.id,
                route: "Synthetic office to airport",
                distance: "42.00",
                mileageDate: "2026-07-18",
            })
            .returning();
        const lineItemId = insertedLineItems[0]?.id;
        const mileageEntryId = insertedMileageEntries[0]?.id;

        if (lineItemId === undefined || mileageEntryId === undefined) {
            throw new Error("Expected reimbursable source rows to be created");
        }

        const submitted = await submitDraftExpenseReport(
            tenantId,
            report.id,
            actorId,
            submissionId,
            {
                coded_items: [
                    {
                        source_id: lineItemId,
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: true,
                    },
                    {
                        source_id: mileageEntryId,
                        source_type: "mileage",
                        category: "Mileage",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6300",
                            account_name: "Mileage Expense",
                        },
                        amount: "29.40",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                ],
                flags: [
                    {
                        source_id: lineItemId,
                        source_type: "line_item",
                        code: "line_item_over_threshold",
                        message:
                            "Line item amount is above the MVP manual review threshold.",
                    },
                ],
            },
            buildSubmissionSourceKeys({
                lineItems: [{ id: lineItemId }],
                mileageEntries: [{ id: mileageEntryId }],
            }),
            buildSubmissionSourceFingerprint({
                lineItems: [
                    {
                        id: lineItemId,
                        merchant: "Synthetic Air",
                        amount: "501.00",
                        currency: "USD",
                        category: "Travel",
                    },
                ],
                mileageEntries: [
                    {
                        id: mileageEntryId,
                        route: "Synthetic office to airport",
                        distance: "42.00",
                        mileageDate: "2026-07-18",
                    },
                ],
            }),
        );

        expect(submitted?.currentStage).toBe("Submitted");

        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(
                and(
                    eq(auditEntry.tenantId, tenantId),
                    eq(auditEntry.expenseReportId, report.id),
                ),
            );
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(
                and(
                    eq(stageTransition.tenantId, tenantId),
                    eq(stageTransition.expenseReportId, report.id),
                ),
            );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, tenantId),
                    eq(glCodingResult.expenseReportId, report.id),
                ),
            );

        expect(auditRows).toHaveLength(2);
        expect(auditRows[1]).toMatchObject({
            tenantId,
            expenseReportId: report.id,
            actorId,
            action: "transition_approved",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Submitted",
            denialReason: null,
        });
        expect(transitionRows).toHaveLength(2);
        expect(transitionRows[1]).toMatchObject({
            tenantId,
            expenseReportId: report.id,
            actor: actorId,
            fromStage: "Drafted",
            toStage: "Submitted",
            reason: "report_submitted",
        });
        expect(codingRows).toHaveLength(2);
        expect(new Set(codingRows.map((row) => row.submissionId))).toEqual(
            new Set([submissionId]),
        );
        expect(codingRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    tenantId,
                    expenseReportId: report.id,
                    sourceType: "line_item",
                    sourceId: lineItemId,
                    category: "Travel",
                    mappingStatus: "mapped",
                    glAccountCode: "6000",
                    glAccountName: "Travel Expense",
                    amount: "501.00",
                    currency: "USD",
                    flaggedLineItem: true,
                    flagCode: "line_item_over_threshold",
                }),
                expect.objectContaining({
                    tenantId,
                    expenseReportId: report.id,
                    sourceType: "mileage",
                    sourceId: mileageEntryId,
                    category: "Mileage",
                    mappingStatus: "mapped",
                    glAccountCode: "6300",
                    glAccountName: "Mileage Expense",
                    amount: "29.40",
                    currency: "USD",
                    flaggedLineItem: false,
                    flagCode: null,
                }),
            ]),
        );
    });

    void test("reads current GL coding as coded_at then id descending", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000192";
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const sourceId = "30000000-0000-4000-8000-000000000192";
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000192",
                submissionId: "90000000-0000-4000-8000-000000000192",
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                flaggedLineItem: false,
                codedAt: new Date("2026-07-18T10:00:00.000Z"),
            },
            {
                id: "91000000-0000-4000-8000-000000000193",
                submissionId: "90000000-0000-4000-8000-000000000193",
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6010",
                glAccountName: "Updated Travel Expense",
                flaggedLineItem: true,
                codedAt: new Date("2026-07-18T10:00:00.000Z"),
            },
        ]);

        const latestRows = await db
            .select()
            .from(glCodingResult)
            .where(
                and(
                    eq(glCodingResult.tenantId, tenantId),
                    eq(glCodingResult.sourceType, "line_item"),
                    eq(glCodingResult.sourceId, sourceId),
                ),
            )
            .orderBy(desc(glCodingResult.codedAt), desc(glCodingResult.id))
            .limit(1);

        expect(latestRows[0]).toMatchObject({
            glAccountCode: "6010",
            glAccountName: "Updated Travel Expense",
            flaggedLineItem: true,
        });
    });

    void test.each([
        [
            "missing coded item",
            {
                coded_items: [],
                flags: [],
            },
        ],
        [
            "extra coded item",
            {
                coded_items: [
                    {
                        source_id: "30000000-0000-4000-8000-000000000193",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                    {
                        source_id: "30000000-0000-4000-8000-000000000999",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "42.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                ],
                flags: [],
            },
        ],
        [
            "duplicate source result",
            {
                coded_items: [
                    {
                        source_id: "30000000-0000-4000-8000-000000000193",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                    {
                        source_id: "30000000-0000-4000-8000-000000000193",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                ],
                flags: [],
            },
        ],
        [
            "orphan flag",
            {
                coded_items: [
                    {
                        source_id: "30000000-0000-4000-8000-000000000193",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                ],
                flags: [
                    {
                        source_id: "30000000-0000-4000-8000-000000000999",
                        source_type: "line_item",
                        code: "line_item_over_threshold",
                        message:
                            "Line item amount is above the MVP manual review threshold.",
                    },
                ],
            },
        ],
        [
            "mapped result without account",
            {
                coded_items: [
                    {
                        source_id: "30000000-0000-4000-8000-000000000193",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "mapped",
                        gl_account: null,
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                ],
                flags: [],
            },
        ],
        [
            "unmapped result with account",
            {
                coded_items: [
                    {
                        source_id: "30000000-0000-4000-8000-000000000193",
                        source_type: "line_item",
                        category: "Travel",
                        mapping_status: "unmapped",
                        gl_account: {
                            account_code: "6000",
                            account_name: "Travel Expense",
                        },
                        amount: "501.00",
                        currency: "USD",
                        flagged_line_item: false,
                    },
                ],
                flags: [],
            },
        ],
    ] as const)(
        "rejects a GL-coding response with %s",
        async (_scenario, glCodingResponse) => {
            const tenantId = "00000000-0000-4000-8000-000000000193";
            const sourceId = randomUUID();
            const preparedResponse = JSON.parse(
                JSON.stringify(glCodingResponse).replaceAll(
                    "30000000-0000-4000-8000-000000000193",
                    sourceId,
                ),
            ) as GlCodingResponse;
            const report = await insertDraftExpenseReport(
                tenantId,
                buildNewExpenseReport(tenantId),
            );

            if (report === undefined) {
                throw new Error("Expected Expense Report to be created");
            }

            await db.insert(lineItem).values({
                id: sourceId,
                tenantId,
                expenseReportId: report.id,
                merchant: "Synthetic Air",
                amount: "501.00",
                currency: "USD",
                category: "Travel",
            });

            await expect(
                submitDraftExpenseReport(
                    tenantId,
                    report.id,
                    report.owner,
                    "90000000-0000-4000-8000-000000000194",
                    preparedResponse,
                    buildSubmissionSourceKeys({
                        lineItems: [{ id: sourceId }],
                        mileageEntries: [],
                    }),
                    buildSubmissionSourceFingerprint({
                        lineItems: [
                            {
                                id: sourceId,
                                merchant: "Synthetic Air",
                                amount: "501.00",
                                currency: "USD",
                                category: "Travel",
                            },
                        ],
                        mileageEntries: [],
                    }),
                ),
            ).rejects.toThrow("GL-coding service");

            const reportRows = await db
                .select()
                .from(expenseReport)
                .where(
                    and(
                        eq(expenseReport.tenantId, tenantId),
                        eq(expenseReport.id, report.id),
                    ),
                );
            const auditRows = await db
                .select()
                .from(auditEntry)
                .where(
                    and(
                        eq(auditEntry.tenantId, tenantId),
                        eq(auditEntry.expenseReportId, report.id),
                    ),
                );
            const transitionRows = await db
                .select()
                .from(stageTransition)
                .where(
                    and(
                        eq(stageTransition.tenantId, tenantId),
                        eq(stageTransition.expenseReportId, report.id),
                    ),
                );
            const codingRows = await db
                .select()
                .from(glCodingResult)
                .where(
                    and(
                        eq(glCodingResult.tenantId, tenantId),
                        eq(glCodingResult.expenseReportId, report.id),
                    ),
                );

            expect(reportRows[0]?.currentStage).toBe("Drafted");
            expect(auditRows).toHaveLength(1);
            expect(transitionRows).toHaveLength(1);
            expect(codingRows).toHaveLength(0);
        },
    );
});
