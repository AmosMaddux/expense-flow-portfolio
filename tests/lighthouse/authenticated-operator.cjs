const tenantId =
    process.env.EXPENSEFLOW_E2E_TENANT_ID ??
    "81000000-0000-4000-8000-000000000001";
const financeAdminUserId = "81000000-0000-4000-8000-000000000004";
const operatorRoles = ["Finance Admin"];

module.exports = async function authenticateOperator(browser) {
    await Promise.all((await browser.pages()).map(installRefreshInterceptor));
    browser.on("targetcreated", async (target) => {
        if (target.type() !== "page") {
            return;
        }

        const page = await target.page().catch(() => undefined);
        if (page !== undefined) {
            await installRefreshInterceptor(page);
        }
    });
};

async function installRefreshInterceptor(page) {
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
        if (isRefreshRequest(request)) {
            await request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(await createSession()),
            });
            return;
        }

        await request.continue();
    });
}

function isRefreshRequest(request) {
    return (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/auth/refresh"
    );
}

async function createSession() {
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds =
        issuedAtSeconds +
        Number(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900);
    const accessToken = await signAccessToken(
        issuedAtSeconds,
        expiresAtSeconds,
    );

    return {
        tenantId,
        userId: financeAdminUserId,
        accessToken,
        accessTokenExpiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
}

async function signAccessToken(issuedAtSeconds, expiresAtSeconds) {
    const { createSign } = await import("node:crypto");
    const header = {
        alg: "RS256",
        typ: "JWT",
        kid: process.env.AUTH_JWT_KEY_ID ?? "local-dev-rs256-v1",
    };
    const payload = {
        iss: process.env.AUTH_JWT_ISSUER ?? "expenseflow-core-case-service",
        sub: financeAdminUserId,
        tenant_id: tenantId,
        roles: operatorRoles,
        token_use: "access",
        iat: issuedAtSeconds,
        exp: expiresAtSeconds,
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
    const privateKey = Buffer.from(
        process.env.AUTH_JWT_PRIVATE_KEY_BASE64 ?? "",
        "base64",
    ).toString("utf8");
    const signature = createSign("RSA-SHA256")
        .update(signingInput)
        .end()
        .sign(privateKey)
        .toString("base64url");

    return `${signingInput}.${signature}`;
}

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}
