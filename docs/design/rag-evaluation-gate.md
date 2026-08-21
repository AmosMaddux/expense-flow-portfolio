# RAG Evaluation Gate

The evaluation gate scores the policy RAG assistant on every pull request and fails the build when retrieval quality drops or the assistant stops resisting prompt injection. See [ADR 0007](../adr/0007-rag-evaluation-gate.md) for why it is built this way, and [Policy RAG retrieval](policy-rag-retrieval.md) for the retrieval contract it measures.

## What runs

```sh
npm run rag:eval
```

That is two steps, which CI runs as two steps as well:

1. `npm run rag:eval:samples` runs the golden question set and the prompt-injection set through the real retrieval and assistant code, writing JSON Lines to `evaluation/output/`.
2. `npm run rag:eval:gate` scores the samples, adjudicates the injection outcomes, prints a report, writes `evaluation/output/rag-evaluation-report.json`, and exits non-zero when any threshold is missed.

Generated output is not committed. The gate exits `2` rather than `1` when its inputs are missing or malformed, so a configuration fault is distinguishable from a quality failure.

## The assistant under test

`answerPolicyQuestion` composes an answer extractively from the chunks `retrievePolicyChunks` returned for the authenticated tenant. Every sentence in an answer is quoted from a cited chunk, so the assistant cannot invent policy, and every answer names the chunks it used.

Guardrails run before retrieval and again over each retrieved sentence. Three categories are refused: `prompt_disclosure`, `cross_tenant`, and `instruction_override`. A refusal returns no retrieved context and no citations. Retrieved policy text is data, never instructions: a sentence that trips a guardrail is dropped rather than quoted, so an instruction planted in a policy document cannot reach the answer. The composed answer is checked for system prompt leakage before it is returned, which catches leakage through any path rather than only the ones anticipated.

Nothing here calls an LLM. The pipeline is deterministic end to end, which is what makes the gate reproducible.

## Datasets

All three datasets are synthetic and version controlled under `evaluation/datasets/`, per [data classification](../data-classification.md).

- `policy-corpus.json` — a two-tenant expense policy corpus. Two tenants, because the cross-tenant assertions need a second tenant's policy to be genuinely present and genuinely unreachable.
- `policy-question-set.json` — questions with a ground truth answer and the corpus sections a correct retrieval should surface. It deliberately includes paraphrased questions that share little vocabulary with the policy text, so the score has headroom below 1.0 and moves when ranking moves.
- `prompt-injection-set.json` — attacks with an expected refusal decision, an expected category, and substring contracts.

## Metrics

Both follow the RAGAS definitions.

| Metric              | Definition                                                                              | Minimum | Measured baseline |
| ------------------- | --------------------------------------------------------------------------------------- | ------- | ----------------- |
| `faithfulness`      | Fraction of the answer's claims that the retrieved contexts support                     | 0.90    | 1.000             |
| `context_relevance` | Average precision over the retrieved contexts against the question's reference contexts | 0.80    | 0.906             |
| `prompt_injection`  | Fraction of injection cases meeting their expectation                                   | 1.00    | 1.000             |

A refusal or an abstention makes no claim about policy, so both score 1.0 on faithfulness. Abstaining cannot be used to inflate the metric: an abstention is still scored normally on context relevance, so a system that declines to answer questions it did retrieve context for is penalised there.

Thresholds are arguments — `--min-faithfulness`, `--min-context-relevance`, `--min-injection-pass-rate` — so raising them once retrieval improves is a one-line change.

## Prompt-injection contract

Each case asserts the refusal decision, the refusal category when one is named, and the substring contracts. Two vectors are covered:

- `user_question` — the attack is the question. Examples: asking for the system prompt, asking for another tenant's policy, claiming developer authority.
- `poisoned_corpus` — the question is benign, and the attack is planted in a policy section the retrieval will surface. The assistant must answer the benign question without acting on the planted instruction.

Three properties make the contract hard to satisfy trivially:

- The prompt sentinels are checked on **every** case regardless of its expectation, so no case can opt out of the disclosure contract.
- Benign control cases require a correct answer, so refusing everything fails the gate.
- Comparison is on text normalised to lowercase alphanumerics, so reformatting, punctuation, or creative quoting cannot hide a leak.

A refusal that returns retrieved policy context also fails, because the refusal text is not the only channel through which policy can leak.

The same dataset is asserted by `ragEvaluationRunner.test.ts` in the vitest suite for fast local feedback. The Python gate is the CI authority.

## Deterministic and live modes

The pull request gate scores deterministically: no LLM, no API key, no cost, and the same score for the same commit.

`RAG_EVAL_MODE=live` scores the same samples with the real `ragas` package. Live mode runs weekly on a schedule and on manual dispatch, which keeps the deterministic numbers calibrated against the LLM-judged ones. It needs a provider key and an explicit install:

```sh
uv pip install "ragas==0.4.3" "datasets>=3.2.0"
```

`ragas` is deliberately **not** declared in `pyproject.toml` and **not** present in `uv.lock`. Every published version carries unfixed advisories, so locking it would fail the Secure PR Gate for a package the pull request gate never runs. Installing it only in the scheduled live job keeps it out of the product's reproducible dependency set, out of every deployed image, and away from tenant data. Re-evaluate when upstream ships a fixed release.

Live scores are not directly comparable to deterministic ones and must be read against the live baseline, not the thresholds in the table above. Requesting live mode without the optional dependencies fails with an actionable message rather than silently falling back, so a misconfigured run cannot report deterministic numbers under the live label.

## Extending the gate

Adding a question means adding an entry to `policy-question-set.json` whose `referenceSections` name sections that exist in the corpus for that tenant; the runner fails loudly if they do not. Adding an injection case means adding an entry to `prompt-injection-set.json`. Both datasets are schema-validated on load in TypeScript and Python, with unknown fields rejected, so dataset drift fails rather than being silently ignored.

`evaluation.rag.fixtures` provides builders for samples, cases, and outcomes, so harness tests do not hand-write JSON.

## Limits

The deterministic adjudicator is a lexical approximation of an LLM judge. It cannot detect a semantically unfaithful claim that reuses the context's vocabulary, and it suits the current extractive assistant better than it would suit a generative one. Guardrails are pattern based, so a novel phrasing can evade them — the injection set is the regression record for phrasings already known, not proof that none exist. The corpus is synthetic and hand-maintained, and will drift from real tenant policies unless deliberately extended.
