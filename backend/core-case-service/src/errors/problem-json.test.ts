import express, { type Express } from "express";
import { type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

import { CreateExpenseReportInboundRequestSchema } from "../schemas/expense-report.schema.js";
import { NotFoundError, problemJsonErrorHandler } from "./problem-json.js";

let activeServer: Server | undefined;

type ProblemJsonBody = {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
};

async function requestTestApp(
    app: Express,
    path: string,
    init?: RequestInit,
): Promise<Response> {
    const server = await listenOnEphemeralPort(app);
    activeServer = server;
    const address = server.address();

    if (address === null || typeof address === "string") {
        throw new Error("Expected test server to listen on a TCP port");
    }

    return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

function listenOnEphemeralPort(app: Express): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1");
        server.once("listening", () => {
            resolve(server);
        });
        server.once("error", reject);
    });
}

async function closeActiveServer(): Promise<void> {
    const server = activeServer;
    activeServer = undefined;

    if (server === undefined) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolve();
                return;
            }

            reject(error);
        });
    });
}

function buildProblemJsonTestApp(): Express {
    const app = express();

    app.use(express.json());
    app.post("/expense-reports", (req, res) => {
        const parsed = CreateExpenseReportInboundRequestSchema.parse(req.body);
        res.status(201).json(parsed);
    });
    app.get("/missing-report", () => {
        throw new NotFoundError("Expense Report not found");
    });
    app.get("/unexpected-error", () => {
        throw new Error("database password was accidentally included");
    });
    app.get("/body-parser-parse-failure", () => {
        throw Object.assign(new Error("parser failed"), {
            type: "entity.parse.failed",
        });
    });
    app.use(problemJsonErrorHandler);

    return app;
}

void describe("problemJsonErrorHandler", () => {
    afterEach(async () => {
        await closeActiveServer();
    });

    void test("returns structured Problem+JSON for malformed create requests", async () => {
        const response = await requestTestApp(
            buildProblemJsonTestApp(),
            "/expense-reports",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    dueDate: "07/31/2026",
                }),
            },
        );
        const body = (await response.json()) as ProblemJsonBody;

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(Object.keys(body).sort()).toStrictEqual([
            "detail",
            "instance",
            "status",
            "title",
            "type",
        ]);
        expect(body).toMatchObject({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            instance: "/expense-reports",
        });
        expect(body.detail).toContain("owner:");
        expect(body.detail).toContain("dueDate:");
    });

    void test("returns Problem+JSON when JSON request dates fail DTO validation", async () => {
        const invalidPayload = {
            tenant_id: "10000000-0000-4000-8000-000000000100",
            owner: "20000000-0000-4000-8000-000000000001",
            dueDate: "July 31, 2026",
            priority: "High",
        };
        const response = await requestTestApp(
            buildProblemJsonTestApp(),
            "/expense-reports",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify(invalidPayload),
            },
        );
        const body = (await response.json()) as ProblemJsonBody;

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toMatchObject({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            instance: "/expense-reports",
        });
        expect(body.detail).toContain("dueDate:");
    });

    void test("maps malformed JSON request bodies to a 400 Problem+JSON response", async () => {
        const response = await requestTestApp(
            buildProblemJsonTestApp(),
            "/expense-reports",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: '{"tenant_id": "10000000-0000-4000-8000-000000000100"',
            },
        );
        const body = (await response.json()) as ProblemJsonBody;

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toStrictEqual({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: "Invalid JSON payload format. Please check your syntax.",
            instance: "/expense-reports",
        });
    });

    void test("maps parser failure objects to a 400 Problem+JSON response", async () => {
        const response = await requestTestApp(
            buildProblemJsonTestApp(),
            "/body-parser-parse-failure",
        );
        const body = (await response.json()) as ProblemJsonBody;

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toStrictEqual({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: "Malformed JSON body could not be parsed.",
            instance: "/body-parser-parse-failure",
        });
    });

    void test("maps NotFoundError to a 404 Problem+JSON response", async () => {
        const response = await requestTestApp(
            buildProblemJsonTestApp(),
            "/missing-report",
        );
        const body = (await response.json()) as ProblemJsonBody;

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toStrictEqual({
            type: "about:blank",
            title: "Not Found",
            status: 404,
            detail: "Expense Report not found",
            instance: "/missing-report",
        });
    });

    void test("maps unknown errors to generic 500 responses without leaking internals", async () => {
        const response = await requestTestApp(
            buildProblemJsonTestApp(),
            "/unexpected-error",
        );
        const body = (await response.json()) as ProblemJsonBody;

        expect(response.status).toBe(500);
        expect(response.headers.get("content-type")).toContain(
            "application/problem+json",
        );
        expect(body).toStrictEqual({
            type: "about:blank",
            title: "Internal Server Error",
            status: 500,
            detail: "An unexpected error occurred.",
            instance: "/unexpected-error",
        });
        expect(JSON.stringify(body)).not.toContain("database password");
        expect(JSON.stringify(body)).not.toContain("stack");
    });
});
