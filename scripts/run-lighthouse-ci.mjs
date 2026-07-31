import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

const apiHealthUrl = "http://127.0.0.1:3301/health";
const previewReadyUrl = "http://127.0.0.1:4173/";
const e2eTenantId =
    process.env.EXPENSEFLOW_E2E_TENANT_ID ??
    "81000000-0000-4000-8000-000000000001";
const childProcesses = [];

await main();

async function main() {
    try {
        await ensureLocalEnv();
        loadDotenv();
        await run("npm", ["run", "e2e:services"]);
        await run("npm", ["run", "e2e:reset"]);
        await run("npm", ["run", "build"], {
            VITE_API_BASE_URL: "",
            VITE_TENANT_ID: e2eTenantId,
        });

        const api = start("node", [
            "--env-file=.env",
            "backend/core-case-service/dist/index.js",
        ]);
        await waitForHttp(apiHealthUrl);

        const preview = start("node", ["scripts/serve-lighthouse-preview.mjs"]);
        await waitForHttp(previewReadyUrl);

        await run("npx", ["lhci", "autorun", "--config=lighthouserc.cjs"], {
            LIGHTHOUSE_CHROME_PATH: chromium.executablePath(),
        });

        await stopChild(preview);
        await stopChild(api);
    } finally {
        await Promise.allSettled(childProcesses.map(stopChild));
    }
}

async function ensureLocalEnv() {
    const envContents = await readFile(".env", "utf8").catch(() => "");
    if (
        envContents.length > 0 &&
        !envContents.includes("replace-with-base64-encoded-rsa")
    ) {
        return;
    }

    await run("./scripts/generate-dev-jwt-keys.sh", []);
}

function loadDotenv() {
    const contents = readFileSync(".env", "utf8");
    for (const line of contents.split(/\r?\n/)) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (match === null || process.env[match[1]] !== undefined) {
            continue;
        }

        process.env[match[1]] = match[2];
    }
}

function run(command, args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: { ...process.env, ...env },
            stdio: "inherit",
        });
        child.once("error", reject);
        child.once("exit", (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(`${command} ${args.join(" ")} exited with ${code}`),
            );
        });
    });
}

function start(command, args, env = {}) {
    const child = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: "inherit",
    });
    childProcesses.push(child);
    return child;
}

async function waitForHttp(url) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        const response = await fetch(url).catch(() => undefined);
        if (response?.ok) {
            return;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 500);
        });
    }

    throw new Error(`${url} was not ready before the timeout.`);
}

function stopChild(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill("SIGKILL");
            }
        }, 5_000).unref();
    });
}
