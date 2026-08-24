import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { PolicyEmbedder } from "../policyEmbeddingService.js";

const EmbeddingLexiconSchema = z
    .object({
        description: z.string().min(1),
        model: z.string().min(1),
        axes: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
    })
    .strict();

export type EmbeddingLexicon = z.infer<typeof EmbeddingLexiconSchema>;

/**
 * Reads the concept lexicon that defines the evaluation embedding space.
 */
export async function readEmbeddingLexicon(
    lexiconPath: string,
): Promise<EmbeddingLexicon> {
    const raw: unknown = JSON.parse(await readFile(lexiconPath, "utf8"));

    return EmbeddingLexiconSchema.parse(raw);
}

function normalizedText(value: string): string {
    return ` ${value
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .trim()} `;
}

/**
 * Counts how many times an axis term occurs in normalised text.
 *
 * Terms are matched on word boundaries so "mile" does not match "mileage" and
 * inflate an axis twice for the same word.
 */
function termOccurrences(haystack: string, term: string): number {
    const needle = ` ${term
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .trim()} `;
    if (needle.trim().length === 0) {
        return 0;
    }

    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
        count += 1;
        // Overlap the trailing separator so adjacent terms are both counted.
        index = haystack.indexOf(needle, index + needle.length - 1);
    }

    return count;
}

/**
 * Builds a deterministic embedder over the supplied concept lexicon.
 *
 * Each axis is one dimension. A text's raw vector counts the axis terms it
 * contains, and the vector is L2-normalised so cosine similarity is the dot
 * product and lands in [0, 1].
 *
 * This is a stand-in for a real embedding model, not an imitation of one. It
 * exists so the evaluation gate exercises the whole vector path — query
 * embedding, similarity ranking, the tenant and model predicates, and the
 * blend with lexical scoring — reproducibly and without a provider key. Its
 * semantics are the version-controlled lexicon, so a reviewer can see exactly
 * what the space knows.
 */
export function createDeterministicEmbedder(
    lexicon: EmbeddingLexicon,
): PolicyEmbedder {
    const axes = Object.entries(lexicon.axes);

    return {
        model: lexicon.model,
        embedTexts: (texts) =>
            Promise.resolve(
                texts.map((text) => {
                    const haystack = normalizedText(text);
                    const raw = axes.map(([, terms]) =>
                        terms.reduce(
                            (total, term) =>
                                total + termOccurrences(haystack, term),
                            0,
                        ),
                    );
                    const magnitude = Math.sqrt(
                        raw.reduce((total, value) => total + value * value, 0),
                    );

                    return magnitude === 0
                        ? raw.map(() => 0)
                        : raw.map((value) => value / magnitude);
                }),
            ),
    };
}

/**
 * Cosine similarity between two vectors from this space.
 *
 * Vectors are already normalised, so this is the dot product clamped into
 * [0, 1]. A zero vector, meaning text that matched no axis, has no direction
 * and scores 0.
 */
export function cosineSimilarity(
    left: readonly number[],
    right: readonly number[],
): number {
    if (left.length !== right.length || left.length === 0) {
        return 0;
    }

    const dot = left.reduce(
        (total, value, index) => total + value * (right[index] ?? 0),
        0,
    );

    return Math.max(0, Math.min(1, dot));
}
