import { spawn } from "node:child_process";
import net from "node:net";

const timeoutMilliseconds = 60_000;
const pollMilliseconds = 1_000;

async function main() {
    await waitForRequiredPorts();
    await runCommand("tsc", ["--build"]);
    await runCommand("node", ["backend/core-case-service/dist/index.js"]);
}

async function waitForRequiredPorts() {
    const requiredPorts = getRequiredPorts();

    await Promise.all(
        requiredPorts.map(async (dependency) => {
            await waitForPort(dependency);
            console.log(
                `${dependency.name} is listening at ${dependency.host}:${dependency.port}`,
            );
        }),
    );
}

function getRequiredPorts() {
    return [
        endpointFromUrl("PostgreSQL", process.env.DATABASE_URL),
        endpointFromUrl("Redis", process.env.REDIS_URL),
        endpointFromUrl("DynamoDB Local", process.env.DYNAMODB_ENDPOINT),
        endpointFromUrl("MinIO", process.env.RECEIPT_STORAGE_ENDPOINT),
        endpointFromUrl(
            "LocalStack",
            process.env.STAGE_TRANSITION_SNS_ENDPOINT,
        ),
        endpointFromUrl(
            "GL coding service",
            process.env.GL_CODING_SERVICE_BASE_URL,
        ),
    ];
}

function endpointFromUrl(name, rawUrl) {
    if (rawUrl === undefined || rawUrl.trim().length === 0) {
        throw new Error(`${name} URL is not configured in .env.`);
    }

    const url = new URL(rawUrl);
    const protocolDefaultPorts = new Map([
        ["http:", 80],
        ["https:", 443],
        ["postgres:", 5432],
        ["postgresql:", 5432],
        ["redis:", 6379],
    ]);
    const defaultPort = protocolDefaultPorts.get(url.protocol);

    if (url.port.length === 0 && defaultPort === undefined) {
        throw new Error(`${name} URL must include an explicit port: ${rawUrl}`);
    }

    return {
        name,
        host: url.hostname,
        port: url.port.length === 0 ? defaultPort : Number(url.port),
    };
}

async function waitForPort({ host, port, name }) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMilliseconds) {
        if (await canConnect(host, port)) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
    }

    throw new Error(
        `${name} did not start at ${host}:${port} within ${timeoutMilliseconds / 1_000}s.`,
    );
}

function canConnect(host, port) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });

        socket.once("connect", () => {
            socket.end();
            resolve(true);
        });
        socket.once("error", () => {
            socket.destroy();
            resolve(false);
        });
        socket.setTimeout(1_000, () => {
            socket.destroy();
            resolve(false);
        });
    });
}

function runCommand(command, args, envOverrides = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: {
                ...process.env,
                ...envOverrides,
            },
            stdio: "inherit",
        });

        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `${command} ${args.join(" ")} exited with ${signal ?? code}`,
                ),
            );
        });
    });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
