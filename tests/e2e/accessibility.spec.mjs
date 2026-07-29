import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { expectNoCriticalAxeViolations } from "./support/a11y.mjs";
import { e2eAccounts, login } from "./support/auth.mjs";

test.describe("ExpenseFlow accessibility gates", () => {
    test("Dashboard has no critical axe violations", async ({
        page,
    }, testInfo) => {
        await login(page, e2eAccounts.manager);

        await expect(
            page.getByRole("heading", { name: "Finance Dashboard" }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", { name: "Workload Overview" }),
        ).toBeVisible();
        await expect(
            page
                .getByLabel("Finance Dashboard KPI cards")
                .or(page.getByText("No Expense Reports to show")),
        ).toBeVisible();

        await expectNoCriticalAxeViolations(page, testInfo, "Dashboard");
    });

    test("Approval Queue has no critical axe violations", async ({
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
        await expect(
            page.getByRole("table", { name: "Approval Queue reports" }).or(
                page.getByRole("region", {
                    name: "No reports waiting for review",
                }),
            ),
        ).toBeVisible();

        await expectNoCriticalAxeViolations(page, testInfo, "Approval Queue");
    });

    test("Mileage has no critical axe violations", async ({
        page,
    }, testInfo) => {
        let shouldSubmitDraft = false;

        try {
            await login(page, e2eAccounts.employee);
            await createDraftExpenseReport(page);
            shouldSubmitDraft = true;
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

            await expectNoCriticalAxeViolations(page, testInfo, "Mileage");
        } finally {
            if (shouldSubmitDraft) {
                await submitDraftExpenseReport(page);
            }
        }
    });
});

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

async function submitDraftExpenseReport(page) {
    await page.getByRole("link", { name: "Submit Expense" }).click();
    await expect(
        page.getByRole("heading", { name: "Submit Expense" }),
    ).toBeVisible();

    const submitResponse = page.waitForResponse(
        (response) =>
            response.url().includes("/v1/expense-reports/") &&
            response.url().endsWith("/submit") &&
            response.status() === 201,
    );
    await page.getByRole("button", { name: "Submit Expense Report" }).click();
    await submitResponse;

    await expect(
        page.getByRole("heading", { name: "Expense submitted" }),
    ).toBeVisible();
}
