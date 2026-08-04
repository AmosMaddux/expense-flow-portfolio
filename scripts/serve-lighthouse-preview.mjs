import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";

const port = Number(process.env.LIGHTHOUSE_PREVIEW_PORT ?? 4173);
const distDir = path.resolve("frontend/app/dist");
const apiOrigin = new URL(
    process.env.LIGHTHOUSE_API_ORIGIN ?? "http://127.0.0.1:3301",
);

const server = createServer((req, res) => {
    if (req.url?.startsWith("/v1") === true) {
        proxyApiRequest(req, res);
        return;
    }

    serveStaticAsset(req, res).catch((error) => {
        console.error("Unable to serve Lighthouse preview asset.", error);
        sendPlainText(res, 500, "Unable to serve Lighthouse preview asset.");
    });
});

server.listen(port, "127.0.0.1", () => {
    console.log(
        `Lighthouse preview server listening on http://127.0.0.1:${port}`,
    );
});

async function serveStaticAsset(req, res) {
    let pathname;
    try {
        pathname = decodeURIComponent(
            new URL(req.url ?? "/", "http://localhost").pathname,
        );
    } catch {
        sendPlainText(res, 400, "Malformed preview asset URL.");
        return;
    }

    const requestedPath = path.normalize(path.join(distDir, pathname));
    const relativePath = path.relative(distDir, requestedPath);
    const isDistPath =
        relativePath === "" ||
        (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
    if (!isDistPath) {
        sendPlainText(res, 400, "Preview asset path is outside the build.");
        return;
    }

    const filePath = await resolveFilePath(
        requestedPath,
        isNavigationRequest(req, pathname),
    );
    if (filePath === undefined) {
        sendPlainText(res, 404, "Preview asset was not found.");
        return;
    }

    res.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Cache-Control": filePath.endsWith("index.html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") {
        res.end();
        return;
    }

    const stream = createReadStream(filePath);
    stream.on("error", (error) => {
        console.error("Unable to stream Lighthouse preview asset.", error);
        res.destroy(error);
    });
    stream.pipe(res);
}

async function resolveFilePath(assetPath, canServeFallback) {
    const assetStat = await stat(assetPath).catch(() => undefined);
    if (assetStat?.isFile() === true) {
        return assetPath;
    }

    if (!canServeFallback) {
        return undefined;
    }

    const fallbackPath = path.join(distDir, "index.html");
    const fallbackStat = await stat(fallbackPath).catch(() => undefined);

    return fallbackStat?.isFile() === true ? fallbackPath : undefined;
}

function proxyApiRequest(req, res) {
    const proxy = httpRequest(
        new URL(req.url ?? "/", apiOrigin),
        {
            headers: req.headers,
            method: req.method,
        },
        (apiResponse) => {
            res.writeHead(apiResponse.statusCode ?? 502, apiResponse.headers);
            apiResponse.pipe(res);
        },
    );

    proxy.on("error", () => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("API proxy request failed.");
    });
    req.pipe(proxy);
}

function getContentType(filePath) {
    if (filePath.endsWith(".html")) {
        return "text/html; charset=utf-8";
    }

    if (filePath.endsWith(".js")) {
        return "text/javascript; charset=utf-8";
    }

    if (filePath.endsWith(".css")) {
        return "text/css; charset=utf-8";
    }

    return "application/octet-stream";
}

function isNavigationRequest(req, pathname) {
    return (
        (req.method === "GET" || req.method === "HEAD") &&
        (pathname === "/" || (req.headers.accept ?? "").includes("text/html"))
    );
}

function sendPlainText(res, statusCode, message) {
    if (res.headersSent) {
        res.destroy();
        return;
    }

    res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
}
