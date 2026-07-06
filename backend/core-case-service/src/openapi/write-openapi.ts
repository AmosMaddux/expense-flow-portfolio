import { mkdir, writeFile } from "node:fs/promises";

import { coreCaseServiceOpenApiDocument } from "./core-case-service.openapi.js";

const openApiDocumentUrl = new URL(
    "../../../../docs/openapi/core-case-service.openapi.json",
    import.meta.url,
);

/**
 * Writes the generated Core Case Service OpenAPI contract to the repository docs.
 */
export async function writeCoreCaseServiceOpenApiDocument(): Promise<void> {
    await mkdir(new URL(".", openApiDocumentUrl), { recursive: true });
    await writeFile(
        openApiDocumentUrl,
        `${JSON.stringify(coreCaseServiceOpenApiDocument, null, 4)}\n`,
        "utf8",
    );
}

try {
    await writeCoreCaseServiceOpenApiDocument();
} catch (error) {
    console.error("Unable to write Core Case Service OpenAPI document.", error);
    process.exitCode = 1;
}
