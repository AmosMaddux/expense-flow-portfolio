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
    receiptMetadata,
    stageTransition,
    stageTransitionOutbox,
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
    clearExpenseReportFlags,
    countOpenExpenseReportFlags,
    findApprovalQueueLineItems,
    findAuditEntriesByExpenseReportId,
    findEmployeeSubmissionDetail,
    findExpenseReportById,
    findExpenseReportSummaries,
    findCommittedSubmissionByIdempotencyKey,
    findExpenseReportsByOwner,
    insertDraftExpenseContent,
    insertDraftExpenseReport,
    reviewExpenseReportLineItem,
    submitDraftExpenseReport,
    transitionExpenseReportStage,
    updateExpenseReportSourceDeductibility,
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
    function buildSyntheticEmployerValidation() {
        return {
            ein: "123456789",
            legalName: "Synthetic Employer LLC",
            result: {
                status: "valid" as const,
                isValid: true as const,
                normalizedLegalName: "Synthetic Employer LLC",
                serviceReferenceId: "synthetic-ein-reference",
            },
            validatedAt: new Date("2026-07-31T00:00:00.000Z"),
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

    void test("rolls back the Expense Report when the transactional audit insert fails", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000199";
        const reportId = "10000000-0000-4000-8000-000000000199";
        const newReport = buildNewExpenseReport(tenantId);
        newReport.id = reportId;

        await expect(
            insertDraftExpenseReport(tenantId, newReport, "not-a-uuid"),
        ).rejects.toThrow();

        const reports = await db
            .select()
            .from(expenseReport)
            .where(eq(expenseReport.id, reportId));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, reportId));

        expect(reports).toHaveLength(0);
        expect(auditRows).toHaveLength(0);
    });
    void test("finds audit entries by Expense Report id within tenant scope", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000196";
        const newReport = buildNewExpenseReport(targetTenantId);

        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const auditRows = await findAuditEntriesByExpenseReportId(
            targetTenantId,
            report.id,
        );
        const crossTenantRows = await findAuditEntriesByExpenseReportId(
            "00000000-0000-4000-8000-000000000197",
            report.id,
        );

        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({
            tenantId: targetTenantId,
            expenseReportId: report.id,
            action: "report_created",
        });
        expect(crossTenantRows).toHaveLength(0);
    });

    void test("summarizes Expense Reports with category membership", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000182";
        const reportId = "10000000-0000-4000-8000-000000000182";
        const ownerId = "20000000-0000-4000-8000-000000000182";
        const managerId = "40000000-0000-4000-8000-000000000182";

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-07-31",
            currentStage: "Manager Approval",
        });
        await db.insert(lineItem).values([
            {
                id: "30000000-0000-4000-8000-000000000182",
                tenantId,
                expenseReportId: reportId,
                merchant: "Synthetic Rail",
                expenseDate: "2026-07-20",
                category: "Travel",
                amount: "120.00",
                currency: "USD",
            },
            {
                id: "30000000-0000-4000-8000-000000000183",
                tenantId,
                expenseReportId: reportId,
                merchant: "Synthetic Bistro",
                expenseDate: "2026-07-20",
                category: "Meals",
                amount: "30.50",
                currency: "USD",
            },
        ]);
        await db.insert(glCodingResult).values({
            id: "40000000-0000-4000-8000-000000000183",
            submissionId: "40000000-0000-4000-8000-000000000184",
            tenantId,
            expenseReportId: reportId,
            sourceType: "line_item",
            sourceId: "30000000-0000-4000-8000-000000000182",
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            amount: "120.00",
            currency: "USD",
            lineItemReviewAction: "approve",
            lineItemReviewedBy: managerId,
            lineItemReviewedAt: new Date("2026-07-21T12:00:00.000Z"),
            codedAt: new Date("2026-07-20T12:00:00.000Z"),
        });

        const summaries = await findExpenseReportSummaries({
            tenantId,
            limit: 50,
        });

        expect(summaries.items).toHaveLength(1);
        expect(summaries.items[0]).toMatchObject({
            id: reportId,
            employeeId: ownerId,
            managerId,
            category: "Multiple",
            categories: ["Meals", "Travel"],
            amount: "150.50",
            currency: "USD",
            status: "Manager Approval",
        });
        expect(summaries.nextCursor).toBeNull();
    });

    void test("filters and cursor-paginates Expense Report summaries before loading a page", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000955";
        const newerReportId = "10000000-0000-4000-8000-000000000955";
        const olderReportId = "10000000-0000-4000-8000-000000000956";
        const excludedReportId = "10000000-0000-4000-8000-000000000957";
        const ownerId = "20000000-0000-4000-8000-000000000955";

        await db.insert(expenseReport).values([
            {
                id: newerReportId,
                tenantId,
                owner: ownerId,
                dueDate: "2026-07-21",
                currentStage: "Manager Approval",
                createdAt: new Date("2026-07-21T12:00:00.000Z"),
            },
            {
                id: olderReportId,
                tenantId,
                owner: ownerId,
                dueDate: "2026-07-21",
                currentStage: "Manager Approval",
                createdAt: new Date("2026-07-21T11:00:00.000Z"),
            },
            {
                id: excludedReportId,
                tenantId,
                owner: ownerId,
                dueDate: "2026-07-21",
                currentStage: "Manager Approval",
                createdAt: new Date("2026-07-21T13:00:00.000Z"),
            },
        ]);
        await db.insert(lineItem).values([
            {
                id: "30000000-0000-4000-8000-000000000955",
                tenantId,
                expenseReportId: newerReportId,
                merchant: "Synthetic Rail",
                expenseDate: "2026-07-21",
                category: "Travel",
                amount: "120.00",
                currency: "USD",
            },
            {
                id: "30000000-0000-4000-8000-000000000956",
                tenantId,
                expenseReportId: olderReportId,
                merchant: "Synthetic Rail",
                expenseDate: "2026-07-21",
                category: "Travel",
                amount: "110.00",
                currency: "USD",
            },
            {
                id: "30000000-0000-4000-8000-000000000957",
                tenantId,
                expenseReportId: excludedReportId,
                merchant: "Synthetic Bistro",
                expenseDate: "2026-07-21",
                category: "Meals",
                amount: "120.00",
                currency: "USD",
            },
        ]);

        const firstPage = await findExpenseReportSummaries({
            tenantId,
            category: "Travel",
            date: "2026-07-21",
            amountMin: "100",
            amountMax: "130",
            status: ["Manager Approval"],
            limit: 1,
        });
        const secondPage = await findExpenseReportSummaries({
            tenantId,
            category: "Travel",
            date: "2026-07-21",
            amountMin: "100",
            amountMax: "130",
            status: ["Manager Approval"],
            limit: 1,
            cursor: firstPage.nextCursor ?? undefined,
        });

        expect(firstPage.items.map((summary) => summary.id)).toEqual([
            newerReportId,
        ]);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(secondPage.items.map((summary) => summary.id)).toEqual([
            olderReportId,
        ]);
        expect(secondPage.nextCursor).toBeNull();
    });

    void test("orders audit entries by append sequence when timestamps are skewed", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000198";
        const reportId = "10000000-0000-4000-8000-000000000198";
        const ownerId = "20000000-0000-4000-8000-000000000198";
        const actorId = "30000000-0000-4000-8000-000000000198";
        const firstCreatedAt = new Date("2026-07-02T12:00:00.000Z");
        const secondCreatedAt = new Date("2026-07-02T11:59:00.000Z");

        await db.insert(expenseReport).values({
            id: reportId,
            tenantId,
            owner: ownerId,
            dueDate: "2026-07-02",
        });
        await db.insert(auditEntry).values([
            {
                id: "90000000-0000-4000-8000-000000000198",
                tenantId,
                expenseReportId: reportId,
                actorId,
                action: "first_action",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Drafted",
                createdAt: firstCreatedAt,
            },
            {
                id: "10000000-0000-4000-8000-000000000199",
                tenantId,
                expenseReportId: reportId,
                actorId,
                action: "second_action",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Drafted",
                createdAt: secondCreatedAt,
            },
        ]);

        const auditRows = await findAuditEntriesByExpenseReportId(
            tenantId,
            reportId,
        );

        expect(auditRows.map((row) => row.action)).toEqual([
            "first_action",
            "second_action",
        ]);
        expect(auditRows[1]?.createdAt.getTime()).toBeLessThan(
            auditRows[0]?.createdAt.getTime() ?? 0,
        );
        expect(auditRows[0]?.sequence).toBeLessThan(
            auditRows[1]?.sequence ?? 0,
        );
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

    void test("lists only reports matching both tenant and employee owner", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000289";
        const otherTenantId = "00000000-0000-4000-8000-000000000299";
        const targetOwnerId = "20000000-0000-4000-8000-000000000289";
        const otherOwnerId = "20000000-0000-4000-8000-000000000299";
        const targetReport = await insertDraftExpenseReport(
            targetTenantId,
            buildNewExpenseReport(targetTenantId, targetOwnerId),
            targetOwnerId,
        );
        await insertDraftExpenseReport(
            targetTenantId,
            buildNewExpenseReport(targetTenantId, otherOwnerId),
            otherOwnerId,
        );
        await insertDraftExpenseReport(
            otherTenantId,
            buildNewExpenseReport(otherTenantId, targetOwnerId),
            targetOwnerId,
        );

        const reports = await findExpenseReportsByOwner(
            targetTenantId,
            targetOwnerId,
        );

        expect(reports.map((report) => report.id)).toEqual([targetReport?.id]);
        expect(reports).toHaveLength(1);
    });

    void test("reads submission detail only for the owning employee and tenant", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000288";
        const targetOwnerId = "20000000-0000-4000-8000-000000000288";
        const otherOwnerId = "20000000-0000-4000-8000-000000000298";
        const report = await insertDraftExpenseReport(
            targetTenantId,
            buildNewExpenseReport(targetTenantId, targetOwnerId),
            targetOwnerId,
        );
        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }
        await db.insert(lineItem).values({
            tenantId: targetTenantId,
            expenseReportId: report.id,
            merchant: "Synthetic Rail",
            expenseDate: "2026-07-18",
            amount: "84.25",
            currency: "USD",
            category: "Travel",
        });

        const ownedDetail = await findEmployeeSubmissionDetail(
            targetTenantId,
            report.id,
            targetOwnerId,
        );
        const otherEmployeeDetail = await findEmployeeSubmissionDetail(
            targetTenantId,
            report.id,
            otherOwnerId,
        );
        const otherTenantDetail = await findEmployeeSubmissionDetail(
            "00000000-0000-4000-8000-000000000298",
            report.id,
            targetOwnerId,
        );

        expect(ownedDetail?.lineItems).toHaveLength(1);
        expect(otherEmployeeDetail).toBeUndefined();
        expect(otherTenantDetail).toBeUndefined();
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
                expenseDate: "2026-07-20",
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
            buildSyntheticEmployerValidation(),
            {
                correlationId: "70000000-0000-4000-8000-000000000190",
                eventId: "71000000-0000-4000-8000-000000000190",
                idempotencyKey: "expense-submit-repository-190",
                requestHash: "synthetic-request-hash-190",
                occurredAt: new Date("2026-07-31T12:00:00.000Z"),
            },
        );

        const recovered = await findCommittedSubmissionByIdempotencyKey(
            tenantId,
            report.id,
            "expense-submit-repository-190",
            "synthetic-request-hash-190",
        );
        const otherTenantRecovered =
            await findCommittedSubmissionByIdempotencyKey(
                "00000000-0000-4000-8000-000000000191",
                report.id,
                "expense-submit-repository-190",
                "synthetic-request-hash-190",
            );

        expect(recovered?.correlationId).toBe(
            "70000000-0000-4000-8000-000000000190",
        );
        expect(recovered?.report.id).toBe(report.id);
        expect(otherTenantRecovered).toBeUndefined();

        expect(submitted).toMatchObject({
            currentStage: "Submitted",
            employerEin: "123456789",
            employerLegalName: "Synthetic Employer LLC",
            employerEinValidationStatus: "valid",
            employerEinValidationReason: null,
            employerEinServiceReferenceId: "synthetic-ein-reference",
        });
        expect(submitted?.employerEinValidatedAt).toBeInstanceOf(Date);

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

        expect(auditRows).toHaveLength(3);
        expect(
            auditRows.find((row) => row.action === "transition_approved"),
        ).toMatchObject({
            tenantId,
            expenseReportId: report.id,
            actorId,
            action: "transition_approved",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Submitted",
            denialReason: null,
        });
        expect(
            auditRows.find((row) => row.action === "employer_ein_validated"),
        ).toMatchObject({
            tenantId,
            expenseReportId: report.id,
            actorId,
            action: "employer_ein_validated",
            stageBeforeAction: "Drafted",
            stageAfterProposedAction: "Submitted",
            denialReason: null,
            outcomeReason: JSON.stringify({
                status: "valid",
                reason: null,
                serviceReferenceId: "synthetic-ein-reference",
            }),
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

    void test("locks the report before reading sources so a concurrent content insert cannot escape GL coding", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000290";
        const ownerId = "20000000-0000-4000-8000-000000000290";
        const actorId = "20000000-0000-4000-8000-000000000291";
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId, ownerId),
            ownerId,
        );
        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }
        const sourceId = "30000000-0000-4000-8000-000000000290";
        await db.insert(lineItem).values({
            id: sourceId,
            tenantId,
            expenseReportId: report.id,
            merchant: "Synthetic Air",
            expenseDate: "2026-07-20",
            amount: "125.00",
            currency: "USD",
            category: "Travel",
        });
        const expectedSourceKeys = buildSubmissionSourceKeys({
            lineItems: [{ id: sourceId }],
            mileageEntries: [],
        });
        const expectedFingerprint = buildSubmissionSourceFingerprint({
            lineItems: [
                {
                    id: sourceId,
                    merchant: "Synthetic Air",
                    amount: "125.00",
                    currency: "USD",
                    category: "Travel",
                },
            ],
            mileageEntries: [],
        });
        const pool = new Pool({
            connectionString: getCoreCaseTestDatabaseUrl(),
        });

        try {
            // The trigger holds the submit transaction after its row lock is acquired,
            // making the competing write deterministic without changing production code.
            await pool.query(`
                CREATE OR REPLACE FUNCTION hold_synthetic_submission_290()
                RETURNS trigger AS $$
                BEGIN
                    IF NEW.id = '${report.id}'::uuid THEN
                        PERFORM pg_sleep(0.5);
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql
            `);
            await pool.query(`
                CREATE TRIGGER hold_synthetic_submission_290_trigger
                BEFORE UPDATE ON expense_report
                FOR EACH ROW EXECUTE FUNCTION hold_synthetic_submission_290()
            `);

            const submissionPromise = submitDraftExpenseReport(
                tenantId,
                report.id,
                actorId,
                "90000000-0000-4000-8000-000000000290",
                {
                    coded_items: [
                        {
                            source_id: sourceId,
                            source_type: "line_item",
                            category: "Travel",
                            mapping_status: "mapped",
                            gl_account: {
                                account_code: "6000",
                                account_name: "Travel Expense",
                            },
                            amount: "125.00",
                            currency: "USD",
                            flagged_line_item: false,
                        },
                    ],
                    flags: [],
                },
                expectedSourceKeys,
                expectedFingerprint,
                buildSyntheticEmployerValidation(),
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
            const contentPromise = insertDraftExpenseContent({
                tenantId,
                expenseReportId: report.id,
                ownerId,
                actorId: ownerId,
                lineItems: [
                    {
                        merchant: "Synthetic Hotel",
                        expenseDate: "2026-07-21",
                        category: "Travel",
                        amount: 250,
                        currency: "USD",
                    },
                ],
                receipts: [],
            });

            const [submitted, contentResult] = await Promise.all([
                submissionPromise,
                contentPromise,
            ]);
            const savedLineItems = await db
                .select()
                .from(lineItem)
                .where(eq(lineItem.expenseReportId, report.id));

            expect(submitted?.currentStage).toBe("Submitted");
            expect(contentResult).toMatchObject({
                kind: "invalid_stage",
                currentStage: "Submitted",
            });
            expect(savedLineItems).toHaveLength(1);
        } finally {
            await pool.query(
                "DROP TRIGGER IF EXISTS hold_synthetic_submission_290_trigger ON expense_report",
            );
            await pool.query(
                "DROP FUNCTION IF EXISTS hold_synthetic_submission_290()",
            );
            await pool.end();
        }
    });

    void test("reads current GL coding as coded_at then id descending", async () => {
        const tenantId = randomUUID();
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const sourceId = randomUUID();
        const codingResultIdPrefix = randomUUID().slice(0, 8);
        const olderCodingResultId = `${codingResultIdPrefix}-0000-4000-8000-000000000001`;
        const newerCodingResultId = `${codingResultIdPrefix}-0000-4000-8000-000000000002`;
        await db.insert(glCodingResult).values([
            {
                id: olderCodingResultId,
                submissionId: randomUUID(),
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
                id: newerCodingResultId,
                submissionId: randomUUID(),
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

    void test("returns tenant-scoped receipt metadata with Approval Queue line items", async () => {
        const tenantId = randomUUID();
        const otherTenantId = randomUUID();
        const ownerId = randomUUID();
        const report = await insertDraftExpenseReport(tenantId, {
            ...buildNewExpenseReport(tenantId, ownerId),
            id: randomUUID(),
        });

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "AP Review" })
            .where(eq(expenseReport.id, report.id));
        const insertedLineItems = await db
            .insert(lineItem)
            .values([
                {
                    id: randomUUID(),
                    tenantId,
                    expenseReportId: report.id,
                    merchant: "Synthetic Hotel",
                    expenseDate: "2026-07-21",
                    amount: "242.30",
                    currency: "USD",
                    category: "Travel",
                },
                {
                    id: randomUUID(),
                    tenantId,
                    expenseReportId: report.id,
                    merchant: "Synthetic Parking",
                    expenseDate: "2026-07-21",
                    amount: "24.00",
                    currency: "USD",
                    category: "Travel",
                },
            ])
            .returning({ id: lineItem.id });
        const lineItemId = insertedLineItems[0]?.id;
        const secondLineItemId = insertedLineItems[1]?.id;
        if (lineItemId === undefined || secondLineItemId === undefined) {
            throw new Error("Expected line item to be created");
        }

        const hotelReceiptId = randomUUID();
        const parkingReceiptId = randomUUID();
        const taxiReceiptId = randomUUID();
        await db.insert(receiptMetadata).values([
            {
                id: hotelReceiptId,
                tenantId,
                expenseReportId: report.id,
                lineItemId,
                merchant: "Synthetic Hotel",
                receiptDate: "2026-07-21",
                amount: "242.30",
                blobReference: {
                    objectKey: "synthetic/object-key",
                    filename: "synthetic-hotel.pdf",
                    contentType: "application/pdf",
                },
            },
            {
                id: parkingReceiptId,
                tenantId,
                expenseReportId: report.id,
                lineItemId: secondLineItemId,
                merchant: "Synthetic Parking",
                receiptDate: "2026-07-21",
                amount: "24.00",
                blobReference: {
                    objectKey: "synthetic/parking-object-key",
                    filename: "synthetic-parking.pdf",
                    contentType: "application/pdf",
                },
            },
            {
                id: taxiReceiptId,
                tenantId,
                expenseReportId: report.id,
                lineItemId: null,
                merchant: "Synthetic Taxi",
                receiptDate: "2026-07-22",
                amount: "38.10",
                blobReference: {
                    objectKey: "synthetic/unlinked-object-key",
                    filename: "synthetic-taxi.jpg",
                    contentType: "image/jpeg",
                },
            },
        ]);
        const submissionId = randomUUID();
        await db.insert(glCodingResult).values([
            {
                id: randomUUID(),
                submissionId,
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId: lineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "242.30",
                currency: "USD",
                flaggedLineItem: false,
            },
            {
                id: randomUUID(),
                submissionId,
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId: secondLineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "24.00",
                currency: "USD",
                flaggedLineItem: false,
            },
        ]);

        const otherReport = await insertDraftExpenseReport(otherTenantId, {
            ...buildNewExpenseReport(otherTenantId, randomUUID()),
            id: randomUUID(),
        });

        if (otherReport === undefined) {
            throw new Error(
                "Expected other tenant Expense Report to be created",
            );
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "AP Review" })
            .where(eq(expenseReport.id, otherReport.id));
        const otherLineItems = await db
            .insert(lineItem)
            .values({
                id: randomUUID(),
                tenantId: otherTenantId,
                expenseReportId: otherReport.id,
                merchant: "Synthetic Other Hotel",
                expenseDate: "2026-07-23",
                amount: "310.00",
                currency: "USD",
                category: "Travel",
            })
            .returning({ id: lineItem.id });
        const otherLineItemId = otherLineItems[0]?.id;
        if (otherLineItemId === undefined) {
            throw new Error("Expected other tenant line item to be created");
        }

        await db.insert(receiptMetadata).values({
            id: randomUUID(),
            tenantId: otherTenantId,
            expenseReportId: otherReport.id,
            lineItemId: otherLineItemId,
            merchant: "Synthetic Other Hotel",
            receiptDate: "2026-07-23",
            amount: "310.00",
            blobReference: {
                objectKey: "synthetic/other-tenant-object-key",
                filename: "synthetic-other-hotel.pdf",
                contentType: "application/pdf",
            },
        });
        await db.insert(glCodingResult).values({
            id: randomUUID(),
            submissionId: randomUUID(),
            tenantId: otherTenantId,
            expenseReportId: otherReport.id,
            sourceType: "line_item",
            sourceId: otherLineItemId,
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            amount: "310.00",
            currency: "USD",
            flaggedLineItem: false,
        });

        const rows = await findApprovalQueueLineItems(tenantId);
        const crossTenantRows = await findApprovalQueueLineItems(otherTenantId);
        const reportRow = rows.find((row) => row.expenseReportId === report.id);
        const reportRows = rows.filter(
            (row) => row.expenseReportId === report.id,
        );
        const hotelReceipt = reportRow?.receipts.find(
            (receipt) => receipt.merchant === "Synthetic Hotel",
        );
        const parkingReceipt = reportRow?.receipts.find(
            (receipt) => receipt.merchant === "Synthetic Parking",
        );
        const taxiReceipt = reportRow?.receipts.find(
            (receipt) => receipt.merchant === "Synthetic Taxi",
        );

        expect(reportRows).toHaveLength(2);
        expect(reportRow?.receipts).toHaveLength(3);
        for (const row of reportRows) {
            const receiptIds = row.receipts.map((receipt) => receipt.id);
            expect(receiptIds).toHaveLength(3);
            expect(receiptIds).toEqual(
                expect.arrayContaining([
                    hotelReceiptId,
                    parkingReceiptId,
                    taxiReceiptId,
                ]),
            );
        }
        expect(typeof hotelReceipt?.id).toBe("string");
        expect(hotelReceipt).toMatchObject({
            lineItemId,
            merchant: "Synthetic Hotel",
            receiptDate: "2026-07-21",
            amount: 242.3,
            filename: "synthetic-hotel.pdf",
            contentType: "application/pdf",
        });
        expect(typeof parkingReceipt?.id).toBe("string");
        expect(parkingReceipt).toMatchObject({
            lineItemId: secondLineItemId,
            merchant: "Synthetic Parking",
            receiptDate: "2026-07-21",
            amount: 24,
            filename: "synthetic-parking.pdf",
            contentType: "application/pdf",
        });
        expect(typeof taxiReceipt?.id).toBe("string");
        expect(taxiReceipt).toMatchObject({
            lineItemId: null,
            merchant: "Synthetic Taxi",
            receiptDate: "2026-07-22",
            amount: 38.1,
            filename: "synthetic-taxi.jpg",
            contentType: "image/jpeg",
        });
        expect(JSON.stringify(reportRow)).not.toContain("objectKey");
        expect(crossTenantRows).toHaveLength(1);
        expect(crossTenantRows[0]?.expenseReportId).toBe(otherReport.id);
        expect(crossTenantRows[0]?.receipts).toHaveLength(1);
        expect(crossTenantRows[0]?.receipts[0]).toMatchObject({
            merchant: "Synthetic Other Hotel",
            lineItemId: otherLineItemId,
        });
    });

    void test("preserves receipt metadata when a line item is reviewed", async () => {
        const tenantId = randomUUID();
        const actorId = randomUUID();
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId, actorId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "Manager Approval" })
            .where(eq(expenseReport.id, report.id));
        const insertedLineItems = await db
            .insert(lineItem)
            .values({
                id: randomUUID(),
                tenantId,
                expenseReportId: report.id,
                merchant: "Synthetic Conference Center",
                expenseDate: "2026-07-24",
                amount: "525.00",
                currency: "USD",
                category: "Meals",
            })
            .returning({ id: lineItem.id });
        const lineItemId = insertedLineItems[0]?.id;
        if (lineItemId === undefined) {
            throw new Error("Expected line item to be created");
        }

        const receiptId = randomUUID();
        await db.insert(receiptMetadata).values({
            id: receiptId,
            tenantId,
            expenseReportId: report.id,
            lineItemId,
            merchant: "Synthetic Conference Center",
            receiptDate: "2026-07-24",
            amount: "525.00",
            blobReference: {
                objectKey: "synthetic/conference-receipt",
                filename: "synthetic-conference.pdf",
                contentType: "application/pdf",
            },
        });
        await db.insert(glCodingResult).values({
            id: randomUUID(),
            submissionId: randomUUID(),
            tenantId,
            expenseReportId: report.id,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Meals",
            mappingStatus: "mapped",
            glAccountCode: "6100",
            glAccountName: "Meals Expense",
            amount: "525.00",
            currency: "USD",
            flaggedLineItem: false,
        });

        const result = await reviewExpenseReportLineItem({
            tenantId,
            expenseReportId: report.id,
            sourceId: lineItemId,
            actorId,
            action: "approve",
        });

        expect(result.kind).toBe("reviewed");
        if (result.kind !== "reviewed") {
            throw new Error("Expected line item review to be saved");
        }

        expect(result.lineItem.reviewAction).toBe("approve");
        expect(result.lineItem.receipts).toEqual([
            expect.objectContaining({
                id: receiptId,
                lineItemId,
                merchant: "Synthetic Conference Center",
                filename: "synthetic-conference.pdf",
                contentType: "application/pdf",
            }),
        ]);
    });

    void test("preserves receipt metadata when AP deductibility is updated", async () => {
        const tenantId = randomUUID();
        const actorId = randomUUID();
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId, actorId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "AP Review" })
            .where(eq(expenseReport.id, report.id));
        const insertedLineItems = await db
            .insert(lineItem)
            .values({
                id: randomUUID(),
                tenantId,
                expenseReportId: report.id,
                merchant: "Synthetic Supplier",
                expenseDate: "2026-07-25",
                amount: "89.20",
                currency: "USD",
                category: "Office",
            })
            .returning({ id: lineItem.id });
        const lineItemId = insertedLineItems[0]?.id;
        if (lineItemId === undefined) {
            throw new Error("Expected line item to be created");
        }

        const receiptId = randomUUID();
        await db.insert(receiptMetadata).values({
            id: receiptId,
            tenantId,
            expenseReportId: report.id,
            lineItemId,
            merchant: "Synthetic Supplier",
            receiptDate: "2026-07-25",
            amount: "89.20",
            blobReference: {
                objectKey: "synthetic/supplier-receipt",
                filename: "synthetic-supplier.png",
                contentType: "image/png",
            },
        });
        await db.insert(glCodingResult).values({
            id: randomUUID(),
            submissionId: randomUUID(),
            tenantId,
            expenseReportId: report.id,
            sourceType: "line_item",
            sourceId: lineItemId,
            category: "Office",
            mappingStatus: "mapped",
            glAccountCode: "6200",
            glAccountName: "Office Expense",
            amount: "89.20",
            currency: "USD",
            flaggedLineItem: false,
        });

        const result = await updateExpenseReportSourceDeductibility({
            tenantId,
            expenseReportId: report.id,
            sourceType: "line_item",
            sourceId: lineItemId,
            actorId,
            deductible: true,
        });

        expect(result.kind).toBe("updated");
        if (result.kind !== "updated") {
            throw new Error("Expected source deductibility to be updated");
        }

        expect(result.lineItem.deductible).toBe(true);
        expect(result.lineItem.receipts).toEqual([
            expect.objectContaining({
                id: receiptId,
                lineItemId,
                merchant: "Synthetic Supplier",
                filename: "synthetic-supplier.png",
                contentType: "image/png",
            }),
        ]);
    });

    void test("writes audit and stage-transition rows for an approved transition", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000196";
        const actorId = "20000000-0000-4000-8000-000000000196";
        const newReport = buildNewExpenseReport(targetTenantId);
        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const correlationId = "50000000-0000-4000-8000-000000000196";
        const eventId = "40000000-0000-4000-8000-000000000196";
        const occurredAt = new Date("2026-07-29T18:00:00.000Z");
        const didTransition = await transitionExpenseReportStage({
            tenantId: targetTenantId,
            id: report.id,
            actor: actorId,
            fromStage: "Drafted",
            toStage: "Submitted",
            reason: "employee_submitted",
            correlationId,
            eventId,
            occurredAt,
        });
        const transitionedReport = await findExpenseReportById(
            targetTenantId,
            report.id,
        );
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, report.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, report.id));
        const outboxRows = await db
            .select()
            .from(stageTransitionOutbox)
            .where(eq(stageTransitionOutbox.expenseReportId, report.id));

        expect(didTransition).toBe(true);
        expect(transitionedReport?.currentStage).toBe("Submitted");
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                tenantId: targetTenantId,
                expenseReportId: report.id,
                actorId,
                action: "transition_approved",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Submitted",
                denialReason: null,
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                tenantId: targetTenantId,
                expenseReportId: report.id,
                actor: actorId,
                fromStage: "Drafted",
                toStage: "Submitted",
                reason: "employee_submitted",
            }),
        );
        expect(outboxRows).toContainEqual(
            expect.objectContaining({
                id: eventId,
                tenantId: targetTenantId,
                expenseReportId: report.id,
                correlationId,
                fromStage: "Drafted",
                toStage: "Submitted",
                occurredAt,
                publishedAt: null,
            }),
        );
    });

    void test("writes a denied audit row without transitioning the report", async () => {
        const targetTenantId = "00000000-0000-4000-8000-000000000197";
        const actorId = "20000000-0000-4000-8000-000000000197";
        const newReport = buildNewExpenseReport(targetTenantId);
        const report = await insertDraftExpenseReport(
            targetTenantId,
            newReport,
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        const didTransition = await transitionExpenseReportStage({
            tenantId: targetTenantId,
            id: report.id,
            actor: actorId,
            fromStage: "Drafted",
            toStage: "AP Review",
            reason: "invalid_skip",
        });
        const unchangedReport = await findExpenseReportById(
            targetTenantId,
            report.id,
        );
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, report.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, report.id));

        expect(didTransition).toBe(false);
        expect(unchangedReport?.currentStage).toBe("Drafted");
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                tenantId: targetTenantId,
                expenseReportId: report.id,
                actorId,
                action: "transition_denied",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "AP Review",
                denialReason: "Invalid transition from Drafted to AP Review.",
            }),
        );
        expect(transitionRows).toHaveLength(2);
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "Drafted",
                toStage: "Drafted",
                reason: "report_created",
            }),
        );
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "Drafted",
                toStage: "Drafted",
                reason: "transition_denied: Invalid transition from Drafted to AP Review.",
            }),
        );
    });

    void test("clears line-item flags after review", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000201";
        const actorId = "20000000-0000-4000-8000-000000000201";
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "Manager Approval" })
            .where(eq(expenseReport.id, report.id));

        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000201",
            submissionId: "90000000-0000-4000-8000-000000000201",
            tenantId,
            expenseReportId: report.id,
            sourceType: "line_item",
            sourceId: "30000000-0000-4000-8000-000000000201",
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });

        const beforeCount = await countOpenExpenseReportFlags(
            tenantId,
            report.id,
        );
        const clearedCount = await clearExpenseReportFlags({
            tenantId,
            expenseReportId: report.id,
            actorId,
            sourceIds: ["30000000-0000-4000-8000-000000000201"],
            reason: "reviewed supporting receipt",
        });
        const afterCount = await countOpenExpenseReportFlags(
            tenantId,
            report.id,
        );
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, report.id));
        const auditRows = await db
            .select()
            .from(auditEntry)
            .where(eq(auditEntry.expenseReportId, report.id));

        expect(beforeCount).toBe(1);
        expect(clearedCount).toEqual({
            kind: "cleared",
            clearedFlagCount: 1,
        });
        expect(afterCount).toBe(0);
        expect(codingRows[0]).toMatchObject({
            flaggedLineItem: false,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
        });
        expect(auditRows).toContainEqual(
            expect.objectContaining({
                action: "line_item_flags_cleared",
                actorId,
                denialReason: null,
                outcomeReason: "reviewed supporting receipt",
            }),
        );
    });

    void test("counts only latest-submission flags as active Manager Approval blockers", async () => {
        const tenantId = randomUUID();
        const actorId = randomUUID();
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "Manager Approval" })
            .where(eq(expenseReport.id, report.id));
        const sourceId = randomUUID();
        const olderSubmissionId = randomUUID();
        const latestSubmissionId = randomUUID();
        await db.insert(glCodingResult).values([
            {
                id: randomUUID(),
                submissionId: olderSubmissionId,
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                flaggedLineItem: true,
                flagCode: "line_item_over_threshold",
                flagMessage:
                    "Line item amount is above the MVP manual review threshold.",
                codedAt: new Date("2026-07-18T10:00:00.000Z"),
            },
            {
                id: randomUUID(),
                submissionId: latestSubmissionId,
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                flaggedLineItem: false,
                lineItemReviewAction: "approve",
                lineItemReviewedBy: actorId,
                lineItemReviewedAt: new Date("2026-07-18T10:06:00.000Z"),
                codedAt: new Date("2026-07-18T10:05:00.000Z"),
            },
        ]);

        const activeFlagCount = await countOpenExpenseReportFlags(
            tenantId,
            report.id,
        );
        const didTransition = await transitionExpenseReportStage({
            tenantId,
            id: report.id,
            actor: actorId,
            fromStage: "Manager Approval",
            toStage: "AP Review",
            reason: "manager approved corrected submission",
        });

        expect(activeFlagCount).toBe(0);
        expect(didTransition).toBe(true);
    });

    void test("clearing one of two active flags keeps Manager Approval blocked", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000205";
        const actorId = "20000000-0000-4000-8000-000000000205";
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "Manager Approval" })
            .where(eq(expenseReport.id, report.id));
        await db.insert(glCodingResult).values([
            {
                id: "91000000-0000-4000-8000-000000000205",
                submissionId: "90000000-0000-4000-8000-000000000205",
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId: "30000000-0000-4000-8000-000000000205",
                category: "Travel",
                mappingStatus: "mapped",
                flaggedLineItem: true,
                flagCode: "line_item_over_threshold",
            },
            {
                id: "91000000-0000-4000-8000-000000000206",
                submissionId: "90000000-0000-4000-8000-000000000205",
                tenantId,
                expenseReportId: report.id,
                sourceType: "line_item",
                sourceId: "30000000-0000-4000-8000-000000000206",
                category: "Travel",
                mappingStatus: "mapped",
                flaggedLineItem: true,
                flagCode: "line_item_over_threshold",
            },
        ]);

        const clearResult = await clearExpenseReportFlags({
            tenantId,
            expenseReportId: report.id,
            actorId,
            sourceIds: ["30000000-0000-4000-8000-000000000205"],
            reason: "reviewed first flagged line item",
        });
        const activeFlagCount = await countOpenExpenseReportFlags(
            tenantId,
            report.id,
        );
        const didTransition = await transitionExpenseReportStage({
            tenantId,
            id: report.id,
            actor: actorId,
            fromStage: "Manager Approval",
            toStage: "AP Review",
            reason: "manager approved too early",
        });

        expect(clearResult).toEqual({ kind: "cleared", clearedFlagCount: 1 });
        expect(activeFlagCount).toBe(1);
        expect(didTransition).toBe(false);
    });
    void test("sends Manager Approval back to Drafted while preserving line items and flags", async () => {
        const tenantId = "00000000-0000-4000-8000-000000000202";
        const actorId = "20000000-0000-4000-8000-000000000202";
        const report = await insertDraftExpenseReport(
            tenantId,
            buildNewExpenseReport(tenantId),
        );

        if (report === undefined) {
            throw new Error("Expected Expense Report to be created");
        }

        await db
            .update(expenseReport)
            .set({ currentStage: "Manager Approval" })
            .where(eq(expenseReport.id, report.id));
        await db.insert(lineItem).values({
            id: "30000000-0000-4000-8000-000000000202",
            tenantId,
            expenseReportId: report.id,
            merchant: "Synthetic Rail",
            expenseDate: "2026-07-20",
            amount: "650.00",
            currency: "USD",
            category: "Travel",
        });
        await db.insert(glCodingResult).values({
            id: "91000000-0000-4000-8000-000000000202",
            submissionId: "90000000-0000-4000-8000-000000000202",
            tenantId,
            expenseReportId: report.id,
            sourceType: "line_item",
            sourceId: "30000000-0000-4000-8000-000000000202",
            category: "Travel",
            mappingStatus: "mapped",
            glAccountCode: "6000",
            glAccountName: "Travel Expense",
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
            flagMessage:
                "Line item amount is above the MVP manual review threshold.",
            lineItemReviewAction: "reject",
            lineItemReviewReason: "receipt detail required",
            lineItemReviewedBy: actorId,
            lineItemReviewedAt: new Date("2026-07-20T12:00:00.000Z"),
        });

        const didTransition = await transitionExpenseReportStage({
            tenantId,
            id: report.id,
            actor: actorId,
            fromStage: "Manager Approval",
            toStage: "Drafted",
            reason: "receipt detail required",
        });
        const transitionedReport = await findExpenseReportById(
            tenantId,
            report.id,
        );
        const lineRows = await db
            .select()
            .from(lineItem)
            .where(eq(lineItem.expenseReportId, report.id));
        const codingRows = await db
            .select()
            .from(glCodingResult)
            .where(eq(glCodingResult.expenseReportId, report.id));
        const transitionRows = await db
            .select()
            .from(stageTransition)
            .where(eq(stageTransition.expenseReportId, report.id));

        expect(didTransition).toBe(true);
        expect(transitionedReport?.currentStage).toBe("Drafted");
        expect(lineRows).toHaveLength(1);
        expect(codingRows[0]).toMatchObject({
            flaggedLineItem: true,
            flagCode: "line_item_over_threshold",
        });
        expect(transitionRows).toContainEqual(
            expect.objectContaining({
                fromStage: "Manager Approval",
                toStage: "Drafted",
                actor: actorId,
                reason: "receipt detail required",
            }),
        );
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
            const tenantId = randomUUID();
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
                expenseDate: "2026-07-20",
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
                    buildSyntheticEmployerValidation(),
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
