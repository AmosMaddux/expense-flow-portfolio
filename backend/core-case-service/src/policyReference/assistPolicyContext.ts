import type { PolicyAnswerContext } from "./policyAssistantService.js";
import {
    findTenantPolicyCorpusChunks,
    type TenantExpensePolicyChunkRecord,
} from "./policyCorpusRepository.js";
import { findTenantExpensePolicy } from "./policyReferenceRepository.js";

export type AssistPolicyContextSource = "baseline" | "retrieved";

export type AssistPolicyContext = PolicyAnswerContext & {
    source: AssistPolicyContextSource;
};

export type AssistPolicyContextBundle = {
    baselinePolicyContexts: AssistPolicyContext[];
    retrievedPolicyContexts: AssistPolicyContext[];
    policyContexts: AssistPolicyContext[];
    policyRetrievalStatus:
        "baseline_and_retrieved" | "baseline_only" | "retrieved_only" | "empty";
};

export type AssistPolicyContextRepository = {
    findTenantPolicyCorpusChunks: typeof findTenantPolicyCorpusChunks;
    findTenantExpensePolicy: typeof findTenantExpensePolicy;
};

const defaultRepository: AssistPolicyContextRepository = {
    findTenantPolicyCorpusChunks,
    findTenantExpensePolicy,
};
const baselineContextLimit = 4;
const policyExcerptLength = 1_800;
const baselineTerms = [
    "reimburs",
    "business purpose",
    "receipt",
    "documentation",
    "flag",
    "500",
    "deduct",
    "approval",
    "review",
];

/**
 * Builds the shared policy-context package used by every Assist entry point.
 */
export async function buildAssistPolicyContextBundle(
    tenantId: string,
    retrievedContexts: readonly PolicyAnswerContext[],
    repository: AssistPolicyContextRepository = defaultRepository,
): Promise<AssistPolicyContextBundle> {
    const baselinePolicyContexts = await findBaselinePolicyContexts(
        tenantId,
        repository,
    );
    const retrievedPolicyContexts = retrievedContexts.map((context) => ({
        ...context,
        source: "retrieved" as const,
    }));
    const policyContexts = dedupeContexts([
        ...baselinePolicyContexts,
        ...retrievedPolicyContexts,
    ]);

    return {
        baselinePolicyContexts,
        retrievedPolicyContexts,
        policyContexts,
        policyRetrievalStatus: resolveRetrievalStatus(
            baselinePolicyContexts.length,
            retrievedPolicyContexts.length,
        ),
    };
}

async function findBaselinePolicyContexts(
    tenantId: string,
    repository: AssistPolicyContextRepository,
): Promise<AssistPolicyContext[]> {
    const chunks = await repository.findTenantPolicyCorpusChunks(tenantId);
    const tenantChunks = chunks.filter((chunk) => chunk.tenantId === tenantId);
    const selectedChunks = selectBaselineChunks(tenantChunks);
    if (selectedChunks.length > 0) {
        return selectedChunks.map((chunk) => ({
            citation: `tenant_expense_policy:${chunk.policyHash}:chunk-${chunk.chunkIndex}`,
            section: chunk.section,
            content: chunk.content,
            score: 0,
            source: "baseline",
        }));
    }

    const policy = await repository.findTenantExpensePolicy(tenantId);
    if (policy === null || policy.tenantId !== tenantId) {
        return [];
    }

    const policyText = policy.policyText.trim();
    if (policyText.length === 0) {
        return [];
    }

    return [
        {
            citation: "tenant_expense_policy:baseline:policy-excerpt",
            section: "Baseline policy excerpt",
            content: policyText.slice(0, policyExcerptLength),
            score: 0,
            source: "baseline",
        },
    ];
}

function selectBaselineChunks(
    chunks: readonly TenantExpensePolicyChunkRecord[],
): TenantExpensePolicyChunkRecord[] {
    const scored = chunks.map((chunk, originalIndex) => ({
        chunk,
        originalIndex,
        score: scoreBaselineChunk(chunk),
    }));
    const candidateChunks = scored.some((entry) => entry.score > 0)
        ? scored.filter((entry) => entry.score > 0)
        : scored;

    return candidateChunks
        .sort(
            (left, right) =>
                right.score - left.score ||
                left.chunk.chunkIndex - right.chunk.chunkIndex ||
                left.originalIndex - right.originalIndex,
        )
        .slice(0, baselineContextLimit)
        .map((entry) => entry.chunk);
}

function scoreBaselineChunk(chunk: TenantExpensePolicyChunkRecord): number {
    const normalized = `${chunk.section} ${chunk.content}`.toLowerCase();

    return baselineTerms.reduce(
        (score, term) => score + (normalized.includes(term) ? 1 : 0),
        0,
    );
}

function dedupeContexts(
    contexts: readonly AssistPolicyContext[],
): AssistPolicyContext[] {
    const seen = new Set<string>();
    const deduped: AssistPolicyContext[] = [];

    for (const context of contexts) {
        if (seen.has(context.citation)) {
            continue;
        }
        seen.add(context.citation);
        deduped.push(context);
    }

    return deduped;
}

function resolveRetrievalStatus(
    baselineContextCount: number,
    retrievedContextCount: number,
): AssistPolicyContextBundle["policyRetrievalStatus"] {
    if (baselineContextCount > 0 && retrievedContextCount > 0) {
        return "baseline_and_retrieved";
    }
    if (baselineContextCount > 0) {
        return "baseline_only";
    }
    if (retrievedContextCount > 0) {
        return "retrieved_only";
    }
    return "empty";
}
