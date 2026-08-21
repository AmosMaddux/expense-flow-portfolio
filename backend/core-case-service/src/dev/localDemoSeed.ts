import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";

import {
    loadReceiptStorageConfig,
    type ReceiptStorageConfig,
} from "../config/receiptStorageConfig.js";
import { applyPendingCoreCaseMigrations } from "../db/migrations.js";
import {
    attachmentMetadata,
    auditEntry,
    expenseReport,
    glCode,
    glCodingResult,
    glMapping,
    lineItem,
    receiptMetadata,
    stageTransition,
    tenantExpensePolicy,
} from "../db/schema/index.js";
import * as schema from "../db/schema/index.js";
import {
    getLocalAuthAccounts,
    getLocalAuthAccountTenantId,
    localAuthEnvironmentSchema,
} from "./localAuthConfig.js";
import { seedLocalAuthAccounts } from "./localAuthUser.js";

type LocalDemoDatabase = NodePgDatabase<typeof schema>;
type LocalDemoTransaction = Parameters<
    Parameters<LocalDemoDatabase["transaction"]>[0]
>[0];

const defaultLocalTenantId = "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb";
const demoReportId = "73000000-0000-4000-8000-000000000001";
const hotelLineItemId = "73000000-0000-4000-8000-000000000011";
const railLineItemId = "73000000-0000-4000-8000-000000000012";
const demoSubmissionId = "73000000-0000-4000-8000-000000000020";
const seededAt = new Date("2026-07-23T12:00:00.000Z");
const receiptFixtureDirectory = fileURLToPath(
    new URL("../../../../scripts/fixtures/receipts/", import.meta.url),
);
const demoTransactionsSqlUrl = new URL(
    "../../../../scripts/seed-demo-transactions.sql",
    import.meta.url,
);
const localReceiptStorageHostnames = new Set([
    "127.0.0.1",
    "[::1]",
    "localhost",
    "minio",
]);
const syntheticExpensePolicyText = `ExpenseFlow Synthetic Tenant Expense Policy

Reimbursable expenses must have a clear business purpose, a matching receipt when one is available, and manager approval before AP review.

Meals are reimbursable when they support approved business travel or working sessions. Alcohol, entertainment upgrades, and personal purchases are not reimbursable.

Travel and lodging must use reasonable economy options. Mileage is reimbursed at the configured ExpenseFlow mileage rate.

Line items over $500 may require additional review before payment.`;

const demoGlCodes = [
    {
        id: "73000000-0000-4000-8000-000000000101",
        category: "Travel",
        accountCode: "6000",
        accountName: "Travel Expense",
        description: "Synthetic local travel expense account.",
    },
    {
        id: "73000000-0000-4000-8000-000000000102",
        category: "Meals",
        accountCode: "6100",
        accountName: "Meals Expense",
        description: "Synthetic local meals expense account.",
    },
    {
        id: "73000000-0000-4000-8000-000000000103",
        category: "Lodging",
        accountCode: "6200",
        accountName: "Lodging Expense",
        description: "Synthetic local lodging expense account.",
    },
    {
        id: "73000000-0000-4000-8000-000000000104",
        category: "Mileage",
        accountCode: "6300",
        accountName: "Mileage Expense",
        description: "Synthetic local mileage expense account.",
    },
    {
        id: "73000000-0000-4000-8000-000000000105",
        category: "Office Supplies",
        accountCode: "6400",
        accountName: "Office Supplies Expense",
        description: "Synthetic local office supplies expense account.",
    },
    {
        id: "73000000-0000-4000-8000-000000000106",
        category: "Software",
        accountCode: "6500",
        accountName: "Software Expense",
        description: "Synthetic local software expense account.",
    },
] as const;

const receiptFixtures = [
    {
        id: "73000000-0000-4000-8000-000000000031",
        uploadId: "73000000-0000-4000-8000-000000000041",
        attachmentId: "73000000-0000-4000-8000-000000000051",
        lineItemId: hotelLineItemId,
        merchant: "Northstar Hotels",
        receiptDate: "2026-07-21",
        amount: "742.18",
        filename: "synthetic-hotel-receipt.pdf",
        contentType: "application/pdf",
    },
    {
        id: "73000000-0000-4000-8000-000000000032",
        uploadId: "73000000-0000-4000-8000-000000000042",
        attachmentId: "73000000-0000-4000-8000-000000000052",
        lineItemId: railLineItemId,
        merchant: "Metro Rail",
        receiptDate: "2026-07-22",
        amount: "38.50",
        filename: "synthetic-rail-receipt.png",
        contentType: "image/png",
    },
    {
        id: "73000000-0000-4000-8000-000000000033",
        uploadId: "73000000-0000-4000-8000-000000000043",
        attachmentId: "73000000-0000-4000-8000-000000000053",
        lineItemId: null,
        merchant: "Synthetic Receipt Desk",
        receiptDate: "2026-07-23",
        amount: "12.00",
        filename: "synthetic-unlinked-receipt.pdf",
        contentType: "application/pdf",
    },
] as const;

/**
 * Seeds synthetic demo data for local UI review workflows.
 */
export async function seedLocalDemoData(): Promise<void> {
    const environment = localAuthEnvironmentSchema.parse(process.env);
    const receiptStorageConfig = loadReceiptStorageConfig();
    assertLocalOrExplicitlyAllowedReceiptStorageEndpoint(receiptStorageConfig);

    await applyPendingCoreCaseMigrations(environment.DATABASE_URL);

    const pool = new Pool({ connectionString: environment.DATABASE_URL });
    const database = drizzle(pool, { schema });
    const receiptObjects = await readReceiptFixtureObjects(
        environment.VITE_TENANT_ID,
    );
    const receiptStorageClient = new S3Client({
        ...(receiptStorageConfig.credentials === undefined
            ? {}
            : { credentials: receiptStorageConfig.credentials }),
        ...(receiptStorageConfig.endpoint === undefined
            ? {}
            : { endpoint: receiptStorageConfig.endpoint }),
        forcePathStyle: receiptStorageConfig.forcePathStyle,
        region: receiptStorageConfig.region,
    });

    try {
        await seedLocalAuthAccounts(database, environment);
        await seedAllTransactionsRows(pool, environment.VITE_TENANT_ID);
        await putReceiptObjects(
            receiptStorageClient,
            receiptStorageConfig,
            receiptObjects,
        );
        await database.transaction(async (transaction) => {
            await seedTenantExpensePolicy(
                transaction,
                environment.VITE_TENANT_ID,
            );
            await seedGlReferenceData(transaction, environment.VITE_TENANT_ID);
            await seedReceiptGalleryReport(
                transaction,
                environment.VITE_TENANT_ID,
                getLocalAuthAccounts()[0]!.userId,
                receiptObjects,
            );
        });
        await verifyReceiptObjects(
            receiptStorageClient,
            receiptStorageConfig,
            receiptObjects,
        );

        process.stdout.write(
            [
                "Synthetic local ExpenseFlow demo data is ready.",
                `tenant: ${environment.VITE_TENANT_ID}`,
                `receipt gallery report: ${demoReportId}`,
                `receipt fixtures: ${receiptObjects.length}`,
                ...getLocalAuthAccounts().map(
                    (account) =>
                        `${account.name}: ${account.email} (${account.role}, tenant ${getLocalAuthAccountTenantId(environment, account)})`,
                ),
                "Generate MFA with: npm run dev:auth:code -- <account>",
                "",
            ].join("\n"),
        );
    } finally {
        await pool.end();
    }
}

async function seedAllTransactionsRows(
    pool: Pool,
    tenantId: string,
): Promise<void> {
    const demoTransactionsSql = (
        await readFile(demoTransactionsSqlUrl, "utf8")
    ).replaceAll(defaultLocalTenantId, tenantId);

    await pool.query(demoTransactionsSql);
}

async function seedGlReferenceData(
    transaction: LocalDemoTransaction,
    tenantId: string,
): Promise<void> {
    for (const code of demoGlCodes) {
        const [persistedCode] = await transaction
            .insert(glCode)
            .values({
                id: code.id,
                tenantId,
                accountCode: code.accountCode,
                accountName: code.accountName,
                description: code.description,
            })
            .onConflictDoUpdate({
                target: [glCode.tenantId, glCode.accountCode],
                set: {
                    accountName: code.accountName,
                    description: code.description,
                    updatedAt: seededAt,
                },
            })
            .returning({ id: glCode.id });

        if (persistedCode === undefined) {
            throw new Error(
                `Unable to seed synthetic GL code ${code.accountCode}.`,
            );
        }
    }

    for (const code of demoGlCodes) {
        const [tenantGlCode] = await transaction
            .select({ id: glCode.id })
            .from(glCode)
            .where(
                and(
                    eq(glCode.tenantId, tenantId),
                    eq(glCode.accountCode, code.accountCode),
                ),
            );
        if (tenantGlCode === undefined) {
            throw new Error(
                `Local demo seed could not resolve GL code ${code.accountCode}.`,
            );
        }

        await transaction
            .insert(glMapping)
            .values({
                tenantId,
                category: code.category,
                glCodeId: tenantGlCode.id,
            })
            .onConflictDoUpdate({
                target: [glMapping.tenantId, glMapping.category],
                set: {
                    glCodeId: tenantGlCode.id,
                    updatedAt: seededAt,
                },
            });
    }
}

async function seedTenantExpensePolicy(
    transaction: LocalDemoTransaction,
    tenantId: string,
): Promise<void> {
    await transaction
        .insert(tenantExpensePolicy)
        .values({
            tenantId,
            policyText: syntheticExpensePolicyText,
            updatedAt: seededAt,
        })
        .onConflictDoUpdate({
            target: tenantExpensePolicy.tenantId,
            set: {
                policyText: syntheticExpensePolicyText,
                updatedAt: seededAt,
            },
        });
}

async function seedReceiptGalleryReport(
    transaction: LocalDemoTransaction,
    tenantId: string,
    ownerId: string,
    receiptObjects: ReceiptFixtureObject[],
): Promise<void> {
    await assertReceiptGallerySeedTenant(transaction, tenantId);

    await transaction
        .insert(expenseReport)
        .values({
            id: demoReportId,
            tenantId,
            owner: ownerId,
            currentStage: "AP Review",
            priority: "High",
            dueDate: "2026-07-30",
            onHold: false,
            holdReason: null,
            createdAt: seededAt,
            updatedAt: seededAt,
        })
        .onConflictDoUpdate({
            target: expenseReport.id,
            set: {
                tenantId,
                owner: ownerId,
                currentStage: "AP Review",
                priority: "High",
                dueDate: "2026-07-30",
                onHold: false,
                holdReason: null,
                updatedAt: seededAt,
            },
        });

    await transaction
        .insert(lineItem)
        .values([
            {
                id: hotelLineItemId,
                tenantId,
                expenseReportId: demoReportId,
                merchant: "Northstar Hotels",
                expenseDate: "2026-07-21",
                category: "Lodging",
                amount: "742.18",
                currency: "USD",
                createdAt: seededAt,
                updatedAt: seededAt,
            },
            {
                id: railLineItemId,
                tenantId,
                expenseReportId: demoReportId,
                merchant: "Metro Rail",
                expenseDate: "2026-07-22",
                category: "Travel",
                amount: "38.50",
                currency: "USD",
                createdAt: seededAt,
                updatedAt: seededAt,
            },
        ])
        .onConflictDoUpdate({
            target: lineItem.id,
            set: {
                expenseReportId: demoReportId,
                updatedAt: seededAt,
            },
        });

    await transaction
        .insert(glCodingResult)
        .values([
            {
                id: "73000000-0000-4000-8000-000000000061",
                submissionId: demoSubmissionId,
                tenantId,
                expenseReportId: demoReportId,
                sourceType: "line_item",
                sourceId: hotelLineItemId,
                category: "Lodging",
                mappingStatus: "mapped",
                glAccountCode: "6200",
                glAccountName: "Lodging Expense",
                amount: "742.18",
                currency: "USD",
                flaggedLineItem: false,
                flagCode: null,
                flagMessage: null,
                deductible: false,
                codedAt: seededAt,
            },
            {
                id: "73000000-0000-4000-8000-000000000062",
                submissionId: demoSubmissionId,
                tenantId,
                expenseReportId: demoReportId,
                sourceType: "line_item",
                sourceId: railLineItemId,
                category: "Travel",
                mappingStatus: "mapped",
                glAccountCode: "6000",
                glAccountName: "Travel Expense",
                amount: "38.50",
                currency: "USD",
                flaggedLineItem: false,
                flagCode: null,
                flagMessage: null,
                deductible: false,
                codedAt: seededAt,
            },
        ])
        .onConflictDoUpdate({
            target: glCodingResult.id,
            set: {
                submissionId: demoSubmissionId,
                expenseReportId: demoReportId,
                lineItemReviewAction: null,
                lineItemReviewReason: null,
                lineItemReviewedBy: null,
                lineItemReviewedAt: null,
                codedAt: seededAt,
            },
        });

    await transaction.delete(receiptMetadata).where(
        and(
            eq(receiptMetadata.tenantId, tenantId),
            inArray(
                receiptMetadata.id,
                receiptObjects.map((receipt) => receipt.id),
            ),
        ),
    );

    await transaction.delete(attachmentMetadata).where(
        and(
            eq(attachmentMetadata.tenantId, tenantId),
            inArray(
                attachmentMetadata.id,
                receiptObjects.map((receipt) => receipt.attachmentId),
            ),
        ),
    );

    await transaction.insert(receiptMetadata).values(
        receiptObjects.map((receipt) => ({
            id: receipt.id,
            tenantId,
            expenseReportId: demoReportId,
            lineItemId: receipt.lineItemId,
            merchant: receipt.merchant,
            receiptDate: receipt.receiptDate,
            amount: receipt.amount,
            blobReference: {
                objectKey: receipt.objectKey,
                filename: receipt.filename,
                contentType: receipt.contentType,
                sizeBytes: receipt.sizeBytes,
            },
            createdAt: seededAt,
            updatedAt: seededAt,
        })),
    );

    await transaction.insert(attachmentMetadata).values(
        receiptObjects.map((receipt) => ({
            id: receipt.attachmentId,
            tenantId,
            expenseReportId: demoReportId,
            filename: receipt.filename,
            contentType: receipt.contentType,
            blobReference: {
                objectKey: receipt.objectKey,
                sizeBytes: receipt.sizeBytes,
            },
            createdAt: seededAt,
        })),
    );

    await transaction
        .insert(auditEntry)
        .values([
            {
                id: "73000000-0000-4000-8000-000000000071",
                tenantId,
                expenseReportId: demoReportId,
                actorId: ownerId,
                action: "report_created",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Drafted",
                createdAt: new Date("2026-07-21T12:00:00.000Z"),
            },
            {
                id: "73000000-0000-4000-8000-000000000072",
                tenantId,
                expenseReportId: demoReportId,
                actorId: ownerId,
                action: "transition_approved",
                stageBeforeAction: "Drafted",
                stageAfterProposedAction: "Submitted",
                createdAt: new Date("2026-07-22T12:00:00.000Z"),
            },
            {
                id: "73000000-0000-4000-8000-000000000073",
                tenantId,
                expenseReportId: demoReportId,
                actorId: ownerId,
                action: "transition_approved",
                stageBeforeAction: "Submitted",
                stageAfterProposedAction: "Manager Approval",
                createdAt: new Date("2026-07-23T12:00:00.000Z"),
            },
            {
                id: "73000000-0000-4000-8000-000000000074",
                tenantId,
                expenseReportId: demoReportId,
                actorId: ownerId,
                action: "transition_approved",
                stageBeforeAction: "Manager Approval",
                stageAfterProposedAction: "AP Review",
                createdAt: new Date("2026-07-24T12:00:00.000Z"),
            },
        ])
        .onConflictDoNothing();

    await transaction
        .insert(stageTransition)
        .values([
            {
                id: "73000000-0000-4000-8000-000000000081",
                tenantId,
                expenseReportId: demoReportId,
                actor: ownerId,
                fromStage: "Drafted",
                toStage: "Drafted",
                reason: "report_created",
                occurredAt: new Date("2026-07-21T12:00:00.000Z"),
            },
            {
                id: "73000000-0000-4000-8000-000000000082",
                tenantId,
                expenseReportId: demoReportId,
                actor: ownerId,
                fromStage: "Drafted",
                toStage: "Submitted",
                reason: "Synthetic demo workflow progression.",
                occurredAt: new Date("2026-07-22T12:00:00.000Z"),
            },
            {
                id: "73000000-0000-4000-8000-000000000083",
                tenantId,
                expenseReportId: demoReportId,
                actor: ownerId,
                fromStage: "Submitted",
                toStage: "Manager Approval",
                reason: "Synthetic demo workflow progression.",
                occurredAt: new Date("2026-07-23T12:00:00.000Z"),
            },
            {
                id: "73000000-0000-4000-8000-000000000084",
                tenantId,
                expenseReportId: demoReportId,
                actor: ownerId,
                fromStage: "Manager Approval",
                toStage: "AP Review",
                reason: "Synthetic demo workflow progression.",
                occurredAt: new Date("2026-07-24T12:00:00.000Z"),
            },
        ])
        .onConflictDoNothing();
}

async function assertReceiptGallerySeedTenant(
    transaction: LocalDemoTransaction,
    tenantId: string,
): Promise<void> {
    const fixedDemoRows = [
        ...(await transaction
            .select({
                id: expenseReport.id,
                tenantId: expenseReport.tenantId,
            })
            .from(expenseReport)
            .where(eq(expenseReport.id, demoReportId))),
        ...(await transaction
            .select({
                id: lineItem.id,
                tenantId: lineItem.tenantId,
            })
            .from(lineItem)
            .where(inArray(lineItem.id, [hotelLineItemId, railLineItemId]))),
        ...(await transaction
            .select({
                id: glCodingResult.id,
                tenantId: glCodingResult.tenantId,
            })
            .from(glCodingResult)
            .where(
                inArray(glCodingResult.id, [
                    "73000000-0000-4000-8000-000000000061",
                    "73000000-0000-4000-8000-000000000062",
                ]),
            )),
    ];
    const crossTenantRow = fixedDemoRows.find(
        (row) => row.tenantId !== tenantId,
    );

    if (crossTenantRow !== undefined) {
        throw new Error(
            [
                "Local demo seed cannot move fixed receipt-gallery demo rows across tenants.",
                `row ${crossTenantRow.id} already belongs to tenant ${crossTenantRow.tenantId}, not ${tenantId}.`,
                "Reset local demo data or rerun the seed with the existing tenant.",
            ].join(" "),
        );
    }
}

type ReceiptFixtureObject = (typeof receiptFixtures)[number] & {
    body: Buffer;
    objectKey: string;
    sizeBytes: number;
};

async function readReceiptFixtureObjects(
    tenantId: string,
): Promise<ReceiptFixtureObject[]> {
    return Promise.all(
        receiptFixtures.map(async (receipt) => {
            const body = await readFile(
                `${receiptFixtureDirectory}/${receipt.filename}`,
            );

            return {
                ...receipt,
                body,
                objectKey: [
                    "tenants",
                    tenantId,
                    "expense-reports",
                    demoReportId,
                    "receipts",
                    receipt.uploadId,
                ].join("/"),
                sizeBytes: body.byteLength,
            };
        }),
    );
}

async function putReceiptObjects(
    client: S3Client,
    config: ReceiptStorageConfig,
    receipts: ReceiptFixtureObject[],
): Promise<void> {
    await Promise.all(
        receipts.map((receipt) =>
            client.send(
                new PutObjectCommand({
                    Bucket: config.bucket,
                    Key: receipt.objectKey,
                    Body: receipt.body,
                    ContentLength: receipt.sizeBytes,
                    ContentType: receipt.contentType,
                }),
            ),
        ),
    );
}

async function verifyReceiptObjects(
    client: S3Client,
    config: ReceiptStorageConfig,
    receipts: ReceiptFixtureObject[],
): Promise<void> {
    await Promise.all(
        receipts.map(async (receipt) => {
            const object = await client.send(
                new HeadObjectCommand({
                    Bucket: config.bucket,
                    Key: receipt.objectKey,
                }),
            );

            if (
                object.ContentLength !== receipt.sizeBytes ||
                object.ContentType !== receipt.contentType
            ) {
                throw new Error(
                    `Synthetic receipt fixture did not verify: ${receipt.filename}`,
                );
            }
        }),
    );
}

function assertLocalOrExplicitlyAllowedReceiptStorageEndpoint(
    config: ReceiptStorageConfig,
): void {
    // Deliberately opt-in only: the sandbox bastion (infra/terraform/modules/bastion,
    // scripts/aws/bastion-run.sh) sets this to seed synthetic demo receipts against the
    // real sandbox S3 bucket (RECEIPT_STORAGE_ENDPOINT unset - real AWS). Never set for
    // local dev, which always points RECEIPT_STORAGE_ENDPOINT at loopback MinIO.
    if (process.env.ALLOW_NON_LOOPBACK_RECEIPT_SEED === "true") {
        return;
    }

    if (config.endpoint === undefined) {
        throw new Error(
            "RECEIPT_STORAGE_ENDPOINT is required for synthetic local demo seeding.",
        );
    }

    const endpoint = new URL(config.endpoint);
    if (!localReceiptStorageHostnames.has(endpoint.hostname)) {
        throw new Error(
            "Synthetic local demo seeding can upload receipts only to loopback object storage.",
        );
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void seedLocalDemoData().catch((error: unknown) => {
        process.stderr.write(
            error instanceof Error
                ? `${error.message}\n`
                : "Unable to seed synthetic local demo data.\n",
        );
        process.exitCode = 1;
    });
}
