import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { expectNoSeriousOrCriticalAxeViolations } from "./support/a11y.mjs";
import { e2eAccounts, login, resetE2eTestData } from "./support/auth.mjs";

test.describe("ExpenseFlow accessibility gates", () => {
    test("Dashboard has no serious or critical axe violations", async ({
        page,
    }, testInfo) => {
        await login(page, e2eAccounts.financeAdmin);

        await expect(
            page.getByRole("heading", { name: "Finance Dashboard" }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "Workload Overview" }),
        ).toBeVisible();
        await expect(
            page.getByLabel("Finance Dashboard KPI cards"),
        ).toBeVisible();
        await expectKpi(page, "Drafted", "0", "0 overdue");
        await expectKpi(page, "Submitted", "1", "1 overdue");
        await expectKpi(page, "Manager Approval", "1", "0 overdue");
        await expectKpi(page, "AP Review", "0", "0 overdue");
        await expectKpi(page, "Paid", "0", "0 overdue");
        await expectKpi(page, "Reconciled", "0", "0 overdue");
        await expectKpi(page, "Overdue Total", "1", "2 total reports");

        await expectNoSeriousOrCriticalAxeViolations(
            page,
            testInfo,
            "Dashboard",
        );
    });

    test("Approval Queue has no serious or critical axe violations", async ({
        page,
    }, testInfo) => {
        await login(page, e2eAccounts.manager);
        await page.getByRole("link", { name: "Approval Queue" }).click();

        await expect(
            page.getByRole("heading", { name: "Case Queue" }),
        ).toBeVisible();
        await expect(page.getByLabel("Approval Queue filters")).toBeVisible();
        await expect(
            page.getByRole("region", { name: "Approval Queue reports" }),
        ).toBeVisible();
        const seededReportRow = page.getByRole("row", {
            name: "Expense Report 81000000-0000-4000-8000-000000000201",
        });
        await expect(
            page.getByRole("table", { name: "Approval Queue reports" }),
        ).toBeVisible();
        await expect(seededReportRow).toBeVisible();
        await expect(seededReportRow).toContainText("Submitted");

        await expectNoSeriousOrCriticalAxeViolations(
            page,
            testInfo,
            "Approval Queue",
        );
    });

    test("Mileage has no serious or critical axe violations", async ({
        page,
    }, testInfo) => {
        let shouldResetE2eData = false;

        try {
            await login(page, e2eAccounts.employee);
            await createDraftExpenseReport(page);
            shouldResetE2eData = true;
            await page.getByRole("link", { name: "Log Mileage" }).click();

            await expect(
                page.getByRole("heading", { name: "New Mileage Log" }),
            ).toBeVisible();
            await expect(page.getByLabel("Trip Date")).toBeVisible();
            await expect(page.getByLabel("Route (From)")).toBeVisible();
            await expect(page.getByLabel("Route (To)")).toBeVisible();
            await expect(page.getByLabel("Distance (miles)")).toBeVisible();
            await expect(
                page.getByRole("button", { name: "Add to Draft" }),
            ).toBeVisible();

            await expectNoSeriousOrCriticalAxeViolations(
                page,
                testInfo,
                "Mileage",
            );
        } finally {
            if (shouldResetE2eData) {
                resetE2eTestData();
            }
        }
    });
});

async function expectKpi(page, label, value, helper) {
    const card = page.getByRole("article", { name: `${label} KPI` });
    await expect(card).toBeVisible();
    await expect(card.locator("strong")).toHaveText(value);
    await expect(card).toContainText(helper);
}

async function createDraftExpenseReport(page) {
    await page.getByRole("link", { name: "Submit Expense" }).click();
    await expect(
        page.getByRole("heading", { name: "Submit Expense" }),
    ).toBeVisible();

    await page
        .getByLabel("Merchant")
        .fill(`E2E Accessibility ${randomUUID().slice(0, 8)}`);
    await page.getByLabel("Expense date").fill("2026-07-15");
    await page.getByLabel("Category").selectOption("Travel");
    await page.getByLabel("Amount (USD)").fill("42.00");

    const draftResponse = page.waitForResponse(
        (response) =>
            response.url().includes("/v1/expense-reports/") &&
            response.url().endsWith("/draft-content") &&
            response.status() === 201,
    );
    await page.getByRole("button", { exact: true, name: "Save Draft" }).click();
    await draftResponse;

    await expect(page.getByText("Draft saved")).toBeVisible();
}
