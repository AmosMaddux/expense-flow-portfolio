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

    void serveStaticAsset(req.url ?? "/", res);
});

server.listen(port, "127.0.0.1", () => {
    console.log(
        `Lighthouse preview server listening on http://127.0.0.1:${port}`,
    );
});

async function serveStaticAsset(url, res) {
    const pathname = decodeURIComponent(
        new URL(url, "http://localhost").pathname,
    );
    const requestedPath = path.normalize(path.join(distDir, pathname));
    const relativePath = path.relative(distDir, requestedPath);
    const isDistPath =
        relativePath === "" ||
        (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
    const assetPath = isDistPath
        ? requestedPath
        : path.join(distDir, "index.html");
    const filePath = await resolveFilePath(assetPath);

    res.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Cache-Control": filePath.endsWith("index.html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
}

async function resolveFilePath(assetPath) {
    const assetStat = await stat(assetPath).catch(() => undefined);
    if (assetStat?.isFile() === true) {
        return assetPath;
    }

    return path.join(distDir, "index.html");
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
