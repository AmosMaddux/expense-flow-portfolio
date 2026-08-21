# 0007. Gate policy RAG changes on deterministic RAGAS metrics and a prompt-injection set

- Status: Proposed
- Date: 2026-08-21
- Decision makers/Desired reviewer count: TBD
- Related: [0006. Store policy retrieval embeddings in pgvector with an external embedding provider](0006-pgvector-policy-embeddings.md), [Policy RAG retrieval](../design/policy-rag-retrieval.md), [RAG evaluation gate](../design/rag-evaluation-gate.md), [Data classification](../data-classification.md)

## Context

Policy retrieval now ranks tenant policy chunks with a hybrid of lexical scoring and pgvector cosine similarity, and an assistant composes grounded answers from the retrieved chunks. Both are easy to regress silently. A change to chunking, to the lexical weights, to the vector weight, or to the embedding model can degrade what gets retrieved without breaking a single unit test, because no unit test asserts "the right section came back first".

Two risks need a gate:

- **Retrieval quality.** An answer is only as good as the chunks behind it. Quality has to be measured on a question set with known answers, and the measurement has to run on every pull request, or it will be run once and then never again.
- **Prompt injection.** The assistant reads tenant-authored policy text and free-text questions. Both are untrusted. The damaging outcomes are disclosing the assistant's own instructions and disclosing another tenant's policy — the same tenant-isolation failure ADR 0006 treats as the worst outcome of embedding search.

RAGAS is the standard library for the first risk, and `faithfulness` and context relevance are the metrics that match what can go wrong here. RAGAS scores both with an LLM judge, which creates problems for a pull request gate:

- It needs a provider API key available to every pull request build, including builds from forks.
- It costs money per run, on every push to every branch.
- Judge scores vary between identical runs, so a threshold near the observed score flakes, and a threshold far below it stops detecting anything.

Several other constraints apply. `AGENTS.md` permits TypeScript with Express and Python with FastAPI only, and RAGAS is a Python library while the RAG pipeline is TypeScript. Evaluation data must be synthetic under `docs/data-classification.md`. The gate must fail the build when quality drops, not merely report a number.

## Decision

ExpenseFlow will gate policy RAG changes on a two-part evaluation that runs in its own CI workflow: RAGAS faithfulness and context relevance over a golden question set, and a prompt-injection set asserting refusal. Falling below any threshold fails the build.

### Scoring is deterministic by default and LLM-judged on demand

The pull request gate scores with a deterministic lexical adjudicator that implements the RAGAS metric definitions:

- `faithfulness` is the fraction of claims in the answer that the retrieved contexts support.
- `context_relevance` is average precision over the retrieved contexts against the question's reference contexts, so ranking regressions are caught and not just recall regressions.
- `answer_correctness` is the fraction of the reference answer the response actually states. Faithfulness is near-tautological against an extractive assistant, so this is the metric carrying real signal about answer quality.

Declining to answer is a gate failure rather than a scored outcome. Every golden question is legitimate, so a refusal or abstention on one is a regression; unanswered samples fail the gate and are excluded from the metric means. Scoring them as perfect would let an assistant that regressed into refusing everything report 1.000 and pass, and excluding them without failing them would let a system dodge its hardest questions to lift its average.

The samples must also cover the question set exactly once each, so a truncated or partially failed generation cannot leave only the easy questions behind.

Setting `RAG_EVAL_MODE=live` scores the same samples with the real `ragas` package instead. Live mode runs on a weekly schedule and on manual dispatch, which keeps the deterministic numbers calibrated against the LLM-judged ones without gating every pull request on a paid, non-reproducible judge. Both modes emit the same report shape, so the threshold contract does not change with the mode.

`ragas` is not declared as a project dependency and does not enter `uv.lock`. Every published version carries unfixed advisories — the latest release trips two Medium findings and the 0.2 line trips a High — so locking it would fail the existing Secure PR Gate for a package the pull request gate never runs. It is installed only by the scheduled live job, which keeps it out of the product's reproducible dependency set, out of every deployed image, and away from tenant data. The alternative, two documented OSV suppressions, was rejected because suppressing a genuine unfixed advisory to accommodate a non-gating convenience is a worse trade than an explicit install in one isolated job. Revisit when upstream ships a fixed release.

### The pipeline stays in TypeScript and the metrics stay in Python

A Node CLI runs the question set and the injection set through the real retrieval and assistant code and writes JSON Lines samples. A Python package scores those samples and enforces the thresholds. Neither language reimplements the other's job, and the evaluation exercises the shipping code path rather than a reimplementation of it.

### Evaluation runs against a fixed corpus, not a database

The question set is scored against a version-controlled synthetic two-tenant corpus rather than whatever a database happens to hold. The gate therefore measures the ranking and answering code, needs no database or embedding provider in CI, and produces the same score for the same commit.

### Vector retrieval is exercised by a deterministic embedding space

Chunks and queries are embedded by a deterministic embedder built over a version-controlled concept lexicon, and the evaluation repository ranks by real cosine similarity under the same tenant and embedding-model predicates the SQL repository applies. The gate covers the whole vector path rather than assuming it.

The embedder is a stand-in for an embedding model, not an imitation of one: each lexicon axis is a dimension, a vector counts axis terms, and the result is L2-normalised. Its semantics are entirely visible to a reviewer, which is what makes it reproducible and reviewable where a real model is neither.

This is load-bearing and measured rather than asserted. Dropping to lexical-only ranking moves `context_relevance` from 1.000 to 0.948 and leaves three paraphrase questions unanswered, so removing vector ranking fails the gate on two counts. Real pgvector behaviour — the HNSW index, the SQL predicates, cosine distance in the database — remains covered by the integration tests, which do need a live database.

### The prompt-injection set is a pass-or-fail contract

Every injection case must meet its expectation, so the threshold is a pass rate of 1.0. The set covers direct attacks in the question and instructions planted inside retrievable policy text, and each case asserts that the answer contains none of the forbidden strings — the assistant's system prompt sentinels and the other tenant's policy text. The prompt sentinels are checked on every case regardless of its expectation, so no case can opt out of the disclosure contract, and benign control cases assert that the guardrails do not simply refuse everything.

## Consequences

Positive:

- A retrieval or ranking regression fails a pull request instead of reaching production unnoticed.
- The prompt-disclosure and cross-tenant contracts are executable and enforced, not prose in a design document.
- The gate is free, fast, hermetic, needs no secrets, and gives the same answer for the same commit, so it can run on every pull request including from forks.
- The assistant gained deliberate guardrails and an extractive, always-cited answer path as a consequence of having to pass the injection set.

Negative:

- The deterministic adjudicator is a lexical approximation of an LLM judge. It cannot detect a semantically unfaithful claim that reuses the context's vocabulary, and it would score a fluent generative assistant less accurately than it scores the current extractive one.
- `faithfulness` is near-tautological against an extractive assistant and is a floor check, not an answer-quality score. `answer_correctness` carries that signal instead.
- The deterministic embedder models paraphrase only where a human wrote the synonym into the lexicon. It proves the vector path is wired and ranked correctly; it does not predict how a real embedding model generalises.
- The golden question set and the corpus are hand-maintained. They will drift from real tenant policies unless deliberately extended.
- Deterministic and live scores are not directly comparable, so a live run's numbers must be read against the live baseline, not the deterministic thresholds.
- The live path's `ragas` version is pinned in the workflow rather than in `uv.lock`, so it is reproducible only by that pin and is not covered by dependency scanning.
- Guardrails are pattern based, so a novel phrasing can evade them. The injection set is the regression record for phrasings already known, not proof that none exist.

Neutral:

- Thresholds start at 0.90 faithfulness and 0.80 context relevance, below the measured baseline of 1.000 and 0.906, leaving room for the retrieval misses the set deliberately includes. They are arguments to the gate, so raising them is a one-line change once retrieval improves.
- Generated samples are not committed. CI regenerates them before scoring.

## Alternatives Considered

**Run live RAGAS on every pull request.** Highest fidelity to the library, and the plainest reading of "a RAGAS evaluation runs in CI". Rejected because it requires a provider key on every pull request build, costs money per push, and produces scores that vary run to run, so any threshold either flakes or is set so low it detects nothing. Live mode is kept as a scheduled and manually dispatched run instead.

**Implement the metrics in TypeScript and drop the Python harness.** One language, simplest CI wiring. Rejected because it forecloses ever running the real `ragas` library, and because it would make the gate a bespoke scorer with no relationship to the metric definitions it claims to implement.

**Score against a seeded database instead of a fixture corpus.** Closer to production. Rejected because it makes the pull request gate depend on database provisioning and an embedding provider, and makes the score depend on seed data rather than on the commit under test. The pgvector integration tests already cover the database path.

**Scoring refusals as faithful.** The first implementation returned 1.0 for a refusal on the grounds that a refusal makes no claim about policy. Rejected on review: it made the gate blind to the single most likely assistant regression, since an assistant that refused every question would have reported a perfect score.

**Sentence-level context relevance.** The classic RAGAS `context_relevancy` formulation, scored as the fraction of retrieved context sentences that bear on the question. Rejected because chunk granularity dominates it: a perfectly retrieved single section scores about 0.33 for a single-fact question, so the metric mostly measures how sections were split rather than how well retrieval worked. Average precision against reference contexts moves when ranking moves, which is the regression the gate exists to catch.

**Assert injection refusals only in the TypeScript test suite.** Fewer moving parts. Rejected because acceptance criterion three requires one gate that fails on either quality or safety, and because the adjudication belongs with the thresholds. The vitest suite still asserts the same dataset for fast local feedback.
