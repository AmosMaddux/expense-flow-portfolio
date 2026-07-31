import { defineConfig } from "@playwright/test";

const frontendBaseUrl =
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const e2eTenantId = "81000000-0000-4000-8000-000000000001";
const e2eAsOfDate = "2026-07-31";

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 90_000,
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: frontendBaseUrl,
        headless: true,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        video: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
    webServer: [
        {
            command: "npm start",
            url: "http://127.0.0.1:3301/health",
            timeout: 120_000,
            reuseExistingServer: !process.env.CI,
        },
        {
            command: "npm --workspace frontend/app run dev -- --host 127.0.0.1",
            url: frontendBaseUrl,
            timeout: 120_000,
            reuseExistingServer: !process.env.CI,
            env: {
                ...process.env,
                VITE_FINANCE_DASHBOARD_AS_OF_DATE: e2eAsOfDate,
                VITE_TENANT_ID: e2eTenantId,
            },
        },
    ],
});
