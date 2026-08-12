import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { e2eAccounts, login } from "./support/auth.mjs";

test.describe.configure({ mode: "serial" });

test("employee submits an expense report and manager approves it", async ({
    browser,
}) => {
    test.setTimeout(150_000);

    const merchant = `E2E Travel ${randomUUID().slice(0, 8)}`;
    const employeeContext = await browser.newContext();
    const managerContext = await browser.newContext();
    const financeContext = await browser.newContext();
    let freshManagerContext;
    let managerTotpCode;

    try {
        const employeePage = await employeeContext.newPage();
        await login(employeePage, e2eAccounts.employee);
        await expect(
            employeePage.getByRole("heading", { name: "My Submissions" }),
        ).toBeVisible();

        await employeePage
            .getByRole("link", { name: "Submit Expense" })
            .click();
        await expect(
            employeePage.getByRole("heading", { name: "Submit Expense" }),
        ).toBeVisible();
        await employeePage.getByLabel("Merchant").fill(merchant);
        await employeePage.getByLabel("Expense date").fill("2026-07-15");
        await employeePage.getByLabel("Category").selectOption("Travel");
        await employeePage.getByLabel("Amount (USD)").fill("120.34");
        const submitResponse = employeePage.waitForResponse(
            (response) =>
                response.url().includes("/v1/expense-reports/") &&
                response.url().endsWith("/submit") &&
                response.status() === 201,
        );
        await employeePage
            .getByRole("button", { name: "Submit Expense Report" })
            .click();
        await submitResponse;

        await expect(
            employeePage.getByRole("heading", { name: "Expense submitted" }),
        ).toBeVisible();
        const reportId = await readSubmittedReportId(employeePage);
        await expect(employeePage.getByText("Submitted stage")).toBeVisible();

        const managerPage = await managerContext.newPage();
        managerTotpCode = await login(managerPage, e2eAccounts.manager);
        await expect(
            managerPage.getByRole("heading", {
                level: 1,
                name: "Expense Reports",
            }),
        ).toBeVisible();

        await managerPage.getByRole("link", { name: "Approval Queue" }).click();
        await expect(
            managerPage.getByRole("heading", { name: "Approval Queue" }),
        ).toBeVisible();

        const managerReportRow = managerPage.getByRole("row", {
            name: `Expense Report ${reportId}`,
        });
        await expect(managerReportRow).toBeVisible();
        await expect(managerReportRow).toContainText("Submitted");
        const managerReviewStartedResponse = managerPage.waitForResponse(
            (response) =>
                response.url().includes("/v1/expense-reports/") &&
                response.url().endsWith("/transitions") &&
                response.status() === 200,
        );
        await managerReportRow.getByRole("button", { name: "Review" }).click();
        await managerReviewStartedResponse;

        const dialog = managerPage.getByRole("dialog", {
            name: `Report ${reportId.slice(0, 8)}`,
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("Manager Approval");

        const reviewTable = dialog.getByRole("table", {
            name: "Report review line items",
        });
        const reviewRow = reviewTable.getByRole("row", {
            name: new RegExp(escapeRegExp(merchant)),
        });
        await expect(reviewRow).toBeVisible();
        const approveResponse = managerPage.waitForResponse(
            (response) =>
                response.url().includes("/v1/expense-reports/") &&
                response.url().endsWith("/review") &&
                response.status() === 200,
        );
        await reviewRow.getByRole("button", { name: "Approve" }).click();
        await approveResponse;
        await expect(reviewRow.getByText("Approved")).toBeVisible();

        await expect(
            dialog.getByRole("button", { name: "Advance" }),
        ).toBeEnabled();
        const advanceResponse = managerPage.waitForResponse(
            (response) =>
                response.url().includes("/v1/expense-reports/") &&
                response.url().endsWith("/transitions") &&
                response.status() === 200,
        );
        await dialog.getByRole("button", { name: "Advance" }).click();
        await advanceResponse;
        await expect(dialog).not.toBeVisible();

        freshManagerContext = await browser.newContext();
        const freshManagerPage = await freshManagerContext.newPage();
        await login(freshManagerPage, e2eAccounts.manager, managerTotpCode);
        await freshManagerPage
            .getByRole("link", { name: "Expense Reports" })
            .click();
        await expect(
            freshManagerPage.getByRole("heading", {
                level: 1,
                name: "Expense Reports",
            }),
        ).toBeVisible();
        const persistedManagerRow = freshManagerPage.getByRole("row", {
            name: `Expense Report ${reportId}`,
        });
        await expect(persistedManagerRow).toBeVisible();
        await expect(persistedManagerRow).toContainText("AP Review");

        const financePage = await financeContext.newPage();
        await login(financePage, e2eAccounts.financeAdmin);
        await expect(
            financePage.getByRole("heading", { name: "Finance Dashboard" }),
        ).toBeVisible();
        await financePage
            .getByRole("link", { name: "All Transactions" })
            .click();
        await expect(
            financePage.getByRole("heading", { name: "Transactions" }),
        ).toBeVisible();
        await expect(
            financePage.getByRole("region", { name: "All Transactions list" }),
        ).toBeVisible();
        const financeTransactionRow = financePage.getByRole("row", {
            name: new RegExp(escapeRegExp(merchant)),
        });
        await expect(financeTransactionRow).toBeVisible();
        await financeTransactionRow
            .getByRole("button", { name: "Review" })
            .click();
        const financeDialog = financePage.getByRole("dialog", {
            name: `Expense Report ${reportId.slice(0, 8).toUpperCase()}`,
        });
        await expect(financeDialog).toBeVisible();
        await financeDialog.getByRole("tab", { name: "Audit Trail" }).click();
        await expect(
            financeDialog.getByText("Transition Approved"),
        ).toHaveCount(3);
        await expect(financeDialog).toContainText("Submitted");
        await expect(financeDialog).toContainText("Manager Approval");
        await expect(financeDialog).toContainText("AP Review");
    } finally {
        await Promise.all([
            employeeContext.close(),
            managerContext.close(),
            financeContext.close(),
            freshManagerContext?.close(),
        ]);
    }
});

async function readSubmittedReportId(page) {
    const reportText = await page
        .getByText(/^Expense Report [0-9a-f-]{36}$/)
        .textContent();
    const reportId = reportText?.replace("Expense Report ", "");

    if (reportId === undefined || reportId.length === 0) {
        throw new Error("Submitted report ID was not visible.");
    }

    return reportId;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
