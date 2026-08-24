"""Optional live RAGAS scoring.

The CI gate scores deterministically so a pull request is not gated on a paid,
non-reproducible LLM judge. Setting ``RAG_EVAL_MODE=live`` scores the same
samples with the real ``ragas`` package instead, for scheduled or on-demand runs
that want the LLM-judged numbers.

``ragas`` is deliberately not declared in ``pyproject.toml`` and not present in
``uv.lock``: every published version carries unfixed advisories, and locking a
dependency the pull request gate never runs would fail the Secure PR Gate.
Install it explicitly for a live run::

    uv pip install "ragas==0.4.3" "datasets>=3.2.0"
"""

from __future__ import annotations

from collections.abc import Sequence

from evaluation.rag.models import EvaluationSample, SampleScore


class LiveScoringUnavailableError(RuntimeError):
    """Raised when live scoring is requested but cannot run."""


def score_samples_live(samples: Sequence[EvaluationSample]) -> list[SampleScore]:
    """Scores samples with the RAGAS faithfulness and context-relevance metrics.

    Raises ``LiveScoringUnavailableError`` when ``ragas`` is not installed, so a
    misconfigured live run fails with an actionable message rather than silently
    falling back to deterministic scoring and reporting numbers under the wrong
    mode.
    """
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import context_precision, faithfulness
    except ImportError as error:  # pragma: no cover - depends on optional install
        raise LiveScoringUnavailableError(
            "Live RAGAS scoring needs the optional eval dependencies. "
            'Install them with \'uv pip install "ragas==0.4.3" "datasets>=3.2.0"\'.'
        ) from error

    if not samples:
        return []

    dataset = Dataset.from_dict(
        {
            "question": [sample.question for sample in samples],
            "answer": [sample.answer for sample in samples],
            "contexts": [list(sample.contexts) for sample in samples],
            "ground_truth": [sample.ground_truth for sample in samples],
        }
    )
    result = evaluate(dataset, metrics=[faithfulness, context_precision])
    scored = result.to_pandas()

    return [
        SampleScore(
            id=sample.id,
            faithfulness=_clamp(scored["faithfulness"][index]),
            context_relevance=_clamp(scored["context_precision"][index]),
        )
        for index, sample in enumerate(samples)
    ]


def _clamp(value: float) -> float:
    """Clamps a judge score into the unit interval, mapping NaN to 0.0."""
    if value != value:  # NaN
        return 0.0
    return max(0.0, min(1.0, float(value)))
