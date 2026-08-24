"""Deterministic implementations of the RAGAS metrics the gate enforces.

The metric definitions follow RAGAS:

- ``faithfulness`` is the fraction of claims in the answer that are supported by
  the retrieved contexts.
- ``context_relevance`` is the rank-aware relevance of the retrieved contexts
  to the question, scored as average precision against the reference contexts.
- ``answer_correctness`` is how much of the reference answer the response
  actually states. Unlike faithfulness, this cannot be satisfied by copying
  arbitrary context text, so it is the metric that fails when retrieval surfaces
  the wrong section.

Only answered samples are scored. A refusal or abstention on a golden question
is a gate failure in its own right (see ``evaluation.rag.gate``) rather than a
free 1.0, so declining to answer can never lift a metric mean.

RAGAS scores both with an LLM judge. The judge is replaced here with a
deterministic lexical adjudicator so the CI gate is reproducible, free, and runs
without a provider key. The live RAGAS judge is available through
``evaluation.rag.live`` for on-demand runs; both paths produce the same
``GateReport`` shape, so the threshold contract does not change with the mode.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from evaluation.rag.models import EvaluationSample, SampleScore

_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "any",
        "are",
        "be",
        "by",
        "can",
        "do",
        "does",
        "for",
        "from",
        "how",
        "in",
        "is",
        "it",
        "may",
        "much",
        "must",
        "my",
        "of",
        "on",
        "or",
        "our",
        "that",
        "the",
        "this",
        "to",
        "we",
        "what",
        "when",
        "which",
        "who",
        "why",
        "with",
    }
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")
_TRAILING_CITATIONS = re.compile(r"\s*\((?:tenant_expense_policy:[^)]*)\)\s*$")

# A claim counts as supported when nearly all of its content tokens appear in the
# retrieved contexts. The tolerance absorbs sentence-joining artefacts without
# admitting a claim the contexts do not carry.
_FAITHFULNESS_COVERAGE = 0.90
# A retrieved context counts as relevant when it carries nearly all of a
# reference context's content terms.
_REFERENCE_COVERAGE = 0.90


def tokenize(value: str) -> set[str]:
    """Splits text into lowercase content tokens."""
    return {
        token
        for token in _TOKEN_SPLIT.split(value.lower())
        if len(token) > 2 and token not in _STOP_WORDS
    }


def split_sentences(value: str) -> list[str]:
    """Splits text into non-empty trimmed sentences."""
    return [
        sentence.strip()
        for sentence in _SENTENCE_SPLIT.split(value)
        if sentence.strip()
    ]


def _claims(answer: str) -> list[str]:
    """Extracts the claim sentences from an answer, dropping its citation tail."""
    return split_sentences(_TRAILING_CITATIONS.sub("", answer))


def _coverage(needle: set[str], haystack: set[str]) -> float:
    """Fraction of ``needle`` tokens present in ``haystack``."""
    if not needle:
        return 0.0
    return len(needle & haystack) / len(needle)


def faithfulness(sample: EvaluationSample) -> float:
    """Fraction of the answer's claims that the retrieved contexts support.

    Because the assistant answers extractively, a healthy run scores at or near
    1.0 here by construction. That makes this a floor check that catches an
    answer drifting away from its cited context, not a measure of answer
    quality; ``answer_correctness`` is the metric with real signal.
    """
    claims = _claims(sample.answer)
    if not claims:
        return 0.0

    context_tokens = tokenize(" ".join(sample.contexts))
    if not context_tokens:
        return 0.0

    supported = sum(
        1
        for claim in claims
        if _coverage(tokenize(claim), context_tokens) >= _FAITHFULNESS_COVERAGE
    )

    return supported / len(claims)


def context_relevance(sample: EvaluationSample) -> float:
    """Rank-aware relevance of the retrieved contexts to the question.

    This is the RAGAS context-relevance formulation: average precision over the
    retrieved contexts, where a context is relevant when it carries one of the
    sample's reference contexts. Averaging precision at the ranks that hold a
    relevant context rewards putting the answering section first, so the score
    falls as soon as ranking regresses rather than only when recall does.
    """
    if not sample.contexts:
        return 0.0

    reference_tokens = [tokenize(reference) for reference in sample.reference_contexts]
    hits = 0
    precision_total = 0.0

    for rank, context in enumerate(sample.contexts, start=1):
        context_tokens = tokenize(context)
        if not _covers_reference(context_tokens, reference_tokens):
            continue
        hits += 1
        precision_total += hits / rank

    if hits == 0:
        return 0.0

    return precision_total / min(len(reference_tokens), len(sample.contexts))


def _covers_reference(
    context_tokens: set[str], reference_tokens: list[set[str]]
) -> bool:
    """Reports whether a retrieved context carries one of the reference contexts."""
    return any(
        _coverage(reference, context_tokens) >= _REFERENCE_COVERAGE
        for reference in reference_tokens
        if reference
    )


def answer_correctness(sample: EvaluationSample) -> float:
    """How much of the reference answer the response actually states.

    Scored as the fraction of the ground truth's content tokens that appear in
    the answer. Copying an unrelated context cannot satisfy this, so it is the
    metric that moves when retrieval surfaces the wrong section while the answer
    still quotes faithfully from it.
    """
    ground_truth_tokens = tokenize(sample.ground_truth)
    if not ground_truth_tokens:
        return 0.0

    return _coverage(ground_truth_tokens, tokenize(sample.answer))


def score_samples(samples: Iterable[EvaluationSample]) -> list[SampleScore]:
    """Scores every answered sample.

    Callers must filter out refused and abstained samples first; the gate treats
    those as failures rather than scoring them.
    """
    return [
        SampleScore(
            id=sample.id,
            faithfulness=faithfulness(sample),
            context_relevance=context_relevance(sample),
            answer_correctness=answer_correctness(sample),
        )
        for sample in samples
    ]


def mean(values: Iterable[float]) -> float:
    """Arithmetic mean, returning 0.0 for an empty sequence."""
    collected = list(values)
    if not collected:
        return 0.0
    return sum(collected) / len(collected)
