import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The evaluation harness scores retrieval against the version-controlled
// corpus fixture and never opens a connection, but the retrieval module graph
// resolves the database configuration when it loads. A placeholder keeps the
// harness runnable in CI without provisioning a database.
process.env.DATABASE_URL ??=
    "postgres://evaluation:evaluation@127.0.0.1:1/rag_evaluation_unused";

const {
    createDeterministicEmbedder,
    readEmbeddingLexicon,
    readEvaluationCorpus,
    readPolicyQuestionSet,
    readPromptInjectionSet,
    runPromptInjectionSet,
    runQuestionSet,
} = await import("./ragEvaluationRunner.js");

// Resolved against this module rather than the working directory, because the
// npm script runs inside the service workspace while the datasets live at the
// repository root. Both src and dist sit five levels below that root.
const repositoryRoot = fileURLToPath(
    new URL("../../../../../", import.meta.url),
);
const datasetRoot = resolve(
    process.env.RAG_EVAL_DATASET_DIR ?? `${repositoryRoot}evaluation/datasets`,
);
const outputRoot = resolve(
    process.env.RAG_EVAL_OUTPUT_DIR ?? `${repositoryRoot}evaluation/output`,
);
const samplesPath = resolve(outputRoot, "rag-samples.jsonl");
const injectionPath = resolve(outputRoot, "prompt-injection-results.jsonl");

function toJsonLines(records: readonly unknown[]): string {
    return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

try {
    const corpus = await readEvaluationCorpus(
        resolve(datasetRoot, "policy-corpus.json"),
    );
    const questionSet = await readPolicyQuestionSet(
        resolve(datasetRoot, "policy-question-set.json"),
    );
    const injectionSet = await readPromptInjectionSet(
        resolve(datasetRoot, "prompt-injection-set.json"),
    );

    const lexicon = await readEmbeddingLexicon(
        resolve(datasetRoot, "embedding-lexicon.json"),
    );
    const embedder = createDeterministicEmbedder(lexicon);

    const samples = await runQuestionSet(corpus, questionSet, embedder);
    const injectionOutcomes = await runPromptInjectionSet(
        corpus,
        injectionSet,
        embedder,
    );

    await mkdir(dirname(samplesPath), { recursive: true });
    await writeFile(samplesPath, toJsonLines(samples), "utf8");
    await writeFile(injectionPath, toJsonLines(injectionOutcomes), "utf8");

    process.stdout.write(
        [
            `samples: ${String(samples.length)} -> ${samplesPath}`,
            `injections: ${String(injectionOutcomes.length)} -> ${injectionPath}`,
        ].join("\n") + "\n",
    );
} catch (error) {
    process.stderr.write(
        `RAG evaluation sample generation failed: ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
    process.exitCode = 1;
}
