import { execFileSync } from "node:child_process";

import { expect } from "@playwright/test";

const password =
    process.env.EXPENSEFLOW_E2E_PASSWORD ?? "expenseflow-e2e-local-only";

export const e2eAccounts = {
    employee: {
        name: "employee",
        email: "employee.e2e@example.test",
    },
    manager: {
        name: "manager",
        email: "manager.e2e@example.test",
    },
};
const lastTotpCodeByAccount = new Map();

/**
 * Signs in through the real ExpenseFlow email/password and MFA flow.
 */
export async function login(page, account, previousTotpCode) {
    await page.goto("/login");
    await expect(
        page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await page.getByLabel("Email").fill(account.email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(
        page.getByRole("heading", { name: "Verify your identity" }),
    ).toBeVisible();
    let previousCode =
        previousTotpCode ?? lastTotpCodeByAccount.get(account.name);
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
        const totpCode = await readFreshTotpCode(account.name, previousCode);
        for (const [index, digit] of [...totpCode].entries()) {
            await page.getByLabel(`Digit ${index + 1}`).fill(digit);
        }
        await page.getByRole("button", { name: "Verify" }).click();

        if (await waitForAuthenticatedWorkspace(page)) {
            lastTotpCodeByAccount.set(account.name, totpCode);
            return totpCode;
        }

        previousCode = totpCode;
        lastTotpCodeByAccount.set(account.name, totpCode);
    }

    throw new Error(`Unable to sign in as ${account.name} before MFA expired.`);
}

/**
 * Restores the deterministic E2E tenant data to its seeded baseline.
 */
export function resetE2eTestData() {
    execFileSync(
        "node",
        [
            "--env-file=.env",
            "backend/core-case-service/dist/dev/e2eTestData.js",
            "reset",
        ],
        { encoding: "utf8", stdio: "inherit" },
    );
}

async function waitForAuthenticatedWorkspace(page) {
    try {
        await page
            .getByRole("navigation", { name: "Workspace sections" })
            .waitFor({ state: "visible", timeout: 5_000 });
        return true;
    } catch {
        await expect(
            page.getByRole("heading", { name: "Verify your identity" }),
        ).toBeVisible();
        await expect(page.getByRole("alert")).toBeVisible();
        return false;
    }
}

async function readFreshTotpCode(accountName, previousTotpCode) {
    const deadline = Date.now() + 45_000;

    while (Date.now() < deadline) {
        const totpCode = readTotpCode(accountName);
        if (totpCode !== previousTotpCode) {
            return totpCode;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 1_000);
        });
    }

    throw new Error(`A fresh ${accountName} MFA code was not available.`);
}

function readTotpCode(accountName) {
    return execFileSync(
        "node",
        [
            "--env-file=.env",
            "backend/core-case-service/dist/dev/e2eTestData.js",
            "code",
            accountName,
        ],
        { encoding: "utf8" },
    ).trim();
}
