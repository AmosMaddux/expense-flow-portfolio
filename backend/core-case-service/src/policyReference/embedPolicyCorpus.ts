import { embedPolicyCorpus } from "./policyEmbeddingService.js";

const tenantId = process.argv[2] ?? process.env.POLICY_CORPUS_TENANT_ID;

try {
    const summary = await embedPolicyCorpus(
        tenantId === undefined ? {} : { tenantId },
    );

    process.stdout.write(
        [
            `model: ${summary.embeddingModel}`,
            `pending: ${String(summary.pendingChunkCount)}`,
            `embedded: ${String(summary.embeddedChunkCount)}`,
            `skipped: ${String(summary.skippedChunkCount)}`,
        ].join(" | ") + "\n",
    );
} catch (error) {
    process.stderr.write(
        `Policy corpus embedding failed: ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
    process.exitCode = 1;
}
