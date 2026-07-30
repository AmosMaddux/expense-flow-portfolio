import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const password =
    process.env.EXPENSEFLOW_E2E_PASSWORD ?? "expenseflow-e2e-local-only";
const employeeEmail = "employee.e2e@example.test";
const managerEmail = "manager.e2e@example.test";

test.describe.configure({ mode: "serial" });

test("employee submits an expense report and manager approves it", async ({
    browser,
}) => {
    const merchant = `E2E Travel ${randomUUID().slice(0, 8)}`;
    const employeeContext = await browser.newContext();
    const managerContext = await browser.newContext();
    let freshManagerContext;
    let managerTotpCode;

    try {
        const employeePage = await employeeContext.newPage();
        await login(employeePage, "employee", employeeEmail);
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
        managerTotpCode = await login(managerPage, "manager", managerEmail);
        await expect(
            managerPage.getByRole("heading", { name: "Finance Dashboard" }),
        ).toBeVisible();

        await managerPage.getByRole("link", { name: "Approval Queue" }).click();
        await expect(
            managerPage.getByRole("heading", { name: "Case Queue" }),
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
        await expect(dialog).toContainText("AP Review");

        freshManagerContext = await browser.newContext();
        const freshManagerPage = await freshManagerContext.newPage();
        await login(freshManagerPage, "manager", managerEmail, managerTotpCode);
        await freshManagerPage
            .getByRole("link", { name: "Approval Queue" })
            .click();
        await expect(
            freshManagerPage.getByRole("heading", { name: "Case Queue" }),
        ).toBeVisible();
        const persistedManagerRow = freshManagerPage.getByRole("row", {
            name: `Expense Report ${reportId}`,
        });
        await expect(persistedManagerRow).toBeVisible();
        await expect(persistedManagerRow).toContainText("AP Review");
    } finally {
        await Promise.all([
            employeeContext.close(),
            managerContext.close(),
            freshManagerContext?.close(),
        ]);
    }
});

async function login(page, account, email, previousTotpCode) {
    await page.goto("/login");
    await expect(
        page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(
        page.getByRole("heading", { name: "Verify your identity" }),
    ).toBeVisible();
    const totpCode = await readFreshTotpCode(account, previousTotpCode);
    for (const [index, digit] of [...totpCode].entries()) {
        await page.getByLabel(`Digit ${index + 1}`).fill(digit);
    }
    await page.getByRole("button", { name: "Verify" }).click();

    return totpCode;
}

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

function readTotpCode(account) {
    return execFileSync(
        "node",
        [
            "--env-file=.env",
            "backend/core-case-service/dist/dev/e2eTestData.js",
            "code",
            account,
        ],
        { encoding: "utf8" },
    ).trim();
}

async function readFreshTotpCode(account, previousTotpCode) {
    const deadline = Date.now() + 45_000;

    while (Date.now() < deadline) {
        const totpCode = readTotpCode(account);
        if (totpCode !== previousTotpCode) {
            return totpCode;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 1_000);
        });
    }

    throw new Error(`A fresh ${account} MFA code was not available.`);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
