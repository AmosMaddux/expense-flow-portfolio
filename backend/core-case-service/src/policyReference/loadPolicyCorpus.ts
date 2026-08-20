import { loadExpensePolicyCorpus } from "./policyCorpusLoaderService.js";

const tenantId = process.argv[2] ?? process.env.POLICY_CORPUS_TENANT_ID;

try {
    const summary = await loadExpensePolicyCorpus(
        tenantId === undefined ? {} : { tenantId },
    );

    for (const result of summary.results) {
        process.stdout.write(
            [
                `tenant: ${result.tenantId}`,
                `chunks: ${result.chunkCount}`,
                `policy hash: ${result.policyHash}`,
                `changed: ${String(!result.unchanged)}`,
            ].join(" | ") + "\n",
        );
    }
} catch (error) {
    process.stderr.write(
        `Policy corpus load failed: ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
    process.exitCode = 1;
}
