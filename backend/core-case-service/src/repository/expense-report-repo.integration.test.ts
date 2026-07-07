// import { describe, test, expect, vi, afterEach } from "vitest";
// import { Pool } from "pg";

// import { getCoreCaseTestDatabaseUrl } from "../testSupport/coreCaseTestDatabase.js";

// import { drizzle } from "drizzle-orm/node-postgres";

// // Position of this mock is important, needs to be done before any imports that use it
// vi.mock("../db/client.js", () => {
//     const client = new Pool({
//         connectionString: getCoreCaseTestDatabaseUrl(),
//     });
//     const db = drizzle(client);
//     return {
//         db: db,
//     };
// });

// import { getExpenseReport, newExpenseReport } from "./expense-report-repo.js";
// import { expenseReport, NewExpenseReport } from "../db/schema/expenseReport.js";
// import { db } from "../db/client.js";

// describe("Test Expense Report Repository", () => {
//     afterEach(async () => {
//         await db.delete(expenseReport);
//     });

//     function buildNewExpenseReport(
//         tenantId?: string,
//         ownerId?: string,
//     ): NewExpenseReport {
//         return {
//             tenantId: tenantId ?? "00000000-0000-0000-0000-000000000083",
//             owner: ownerId ?? "20000000-0000-0000-0000-000000000083",
//             dueDate: "2026-07-02",
//         };
//     }

//     test("Can insert new report", async () => {
//         const targetTenantId = "00000000-0000-0000-0000-000000000083";

//         const newReport = buildNewExpenseReport(targetTenantId);

//         const results = await newExpenseReport(targetTenantId, newReport);

//         expect(results.hasData).toBeTruthy();
//         if (results.hasData) {
//             expect(results.data.tenantId).toEqual(targetTenantId);
//             expect(results.data.id).not.toBeUndefined();
//         }
//     });

//     test("Rejects mismatched tenant inserts", async () => {
//         const reportTenantId = "00000000-0000-0000-0000-000000000083";
//         const sessionTenantId = "00000000-0000-0000-0000-000000000093";

//         const newReport = buildNewExpenseReport(reportTenantId);

//         const results = await newExpenseReport(sessionTenantId, newReport);

//         expect(results.hasData).toBeFalsy();
//     });

//     test("Test get report", async () => {
//         const targetTenantId = "00000000-0000-0000-0000-000000000083";
//         const targetId = "10000000-0000-0000-0000-000000000083";

//         const newReport = buildNewExpenseReport(targetTenantId);
//         newReport.id = targetId;

//         const results = await newExpenseReport(targetTenantId, newReport);
//         expect(results.hasData).toBeTruthy();

//         const getResults = await getExpenseReport(targetId, targetTenantId);
//         expect(getResults.hasData).toBeTruthy();

//         if (getResults.hasData) {
//             expect(getResults.data.id).toEqual(targetId);
//             expect(getResults.data.tenantId).toEqual(targetTenantId);
//         }
//     });

//     test("Does not return a report for another tenant", async () => {
//         const reportTenantId = "00000000-0000-0000-0000-000000000083";
//         const callerTenantId = "00000000-0000-0000-0000-000000000093";
//         const targetId = "10000000-0000-0000-0000-000000000083";

//         const newReport = buildNewExpenseReport(reportTenantId);
//         newReport.id = targetId;

//         const results = await newExpenseReport(reportTenantId, newReport);
//         expect(results.hasData).toBeTruthy();

//         const getResults = await getExpenseReport(targetId, callerTenantId);

//         expect(getResults.hasData).toBeFalsy();
//     });

//     test("Test get no reports", async () => {
//         const targetTenantId = "00000000-0000-0000-0000-000000000083";
//         const targetId = "10000000-0000-0000-0000-000000000083";

//         const getResults = await getExpenseReport(targetId, targetTenantId);
//         expect(getResults.hasData).toBeFalsy();
//     });
// });
