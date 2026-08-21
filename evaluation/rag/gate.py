"""The RAGAS evaluation gate.

Reads the samples and prompt-injection outcomes produced by the TypeScript
generator, scores them, and fails when any threshold is missed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from pydantic import ValidationError

from evaluation.rag.injection import evaluate_injection_set
from evaluation.rag.live import score_samples_live
from evaluation.rag.metrics import mean, score_samples
from evaluation.rag.models import (
    EvaluationMode,
    EvaluationSample,
    GateReport,
    GateThresholds,
    InjectionOutcome,
    InjectionSet,
    MetricReport,
    SampleScore,
    UnansweredSample,
)

DEFAULT_SAMPLES_PATH = Path("evaluation/output/rag-samples.jsonl")
DEFAULT_INJECTION_RESULTS_PATH = Path(
    "evaluation/output/prompt-injection-results.jsonl"
)
DEFAULT_INJECTION_SET_PATH = Path("evaluation/datasets/prompt-injection-set.json")
DEFAULT_QUESTION_SET_PATH = Path("evaluation/datasets/policy-question-set.json")
DEFAULT_REPORT_PATH = Path("evaluation/output/rag-evaluation-report.json")


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    """Reads a JSON Lines file into a list of records."""
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} does not exist. Generate it with "
            "'npm run rag:eval:samples' before running the gate."
        )

    records: list[dict[str, object]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise ValueError(f"{path}:{line_number} is not valid JSON.") from error

    return records


def load_samples(path: Path) -> list[EvaluationSample]:
    """Loads and validates the evaluation samples."""
    return [EvaluationSample.model_validate(record) for record in _read_jsonl(path)]


def load_injection_outcomes(path: Path) -> list[InjectionOutcome]:
    """Loads and validates the prompt-injection outcomes."""
    return [InjectionOutcome.model_validate(record) for record in _read_jsonl(path)]


def load_injection_set(path: Path) -> InjectionSet:
    """Loads and validates the prompt-injection test set."""
    return InjectionSet.model_validate_json(path.read_text(encoding="utf8"))


def load_expected_question_ids(path: Path) -> list[str]:
    """Reads the question IDs the sample file is expected to cover."""
    question_set = json.loads(path.read_text(encoding="utf8"))
    questions = question_set.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError(f"{path} contains no questions.")

    return [str(question["id"]) for question in questions]


def validate_sample_coverage(
    samples: Sequence[EvaluationSample], expected_ids: Sequence[str]
) -> list[str]:
    """Checks the samples cover the question set exactly once each.

    A truncated or partially failed generation would otherwise leave only the
    questions that happened to succeed, and an easier subset can clear
    thresholds the full set would not.
    """
    errors: list[str] = []
    seen: dict[str, int] = {}
    for sample in samples:
        seen[sample.id] = seen.get(sample.id, 0) + 1

    expected = set(expected_ids)
    missing = sorted(expected - seen.keys())
    if missing:
        errors.append(
            f"{len(missing)} expected question(s) have no sample: {', '.join(missing)}"
        )

    extra = sorted(seen.keys() - expected)
    if extra:
        errors.append(
            f"{len(extra)} sample(s) are not in the question set: {', '.join(extra)}"
        )

    duplicated = sorted(sample_id for sample_id, count in seen.items() if count > 1)
    if duplicated:
        errors.append(
            f"{len(duplicated)} question(s) have more than one sample: "
            f"{', '.join(duplicated)}"
        )

    if len(samples) < len(expected_ids):
        errors.append(
            f"expected at least {len(expected_ids)} samples, got {len(samples)}"
        )

    return errors


def build_report(
    samples: Sequence[EvaluationSample],
    injection_set: InjectionSet,
    injection_outcomes: Sequence[InjectionOutcome],
    thresholds: GateThresholds,
    mode: EvaluationMode,
    expected_question_ids: Sequence[str] | None = None,
) -> GateReport:
    """Scores every sample and injection case into a single gate report.

    Refused and abstained samples are reported as failures instead of being
    scored. Every question in the golden set is legitimate, so declining one is
    a regression, and excluding them from the means stops a decline from
    inflating a metric.
    """
    unanswered = [
        UnansweredSample(
            id=sample.id,
            reason="refused" if sample.refused else "abstained",
        )
        for sample in samples
        if sample.refused or sample.abstained
    ]
    answered = [
        sample for sample in samples if not sample.refused and not sample.abstained
    ]
    scores: list[SampleScore] = (
        score_samples_live(answered) if mode == "live" else score_samples(answered)
    )
    dataset_errors = (
        validate_sample_coverage(samples, expected_question_ids)
        if expected_question_ids is not None
        else []
    )

    return GateReport(
        mode=mode,
        sample_count=len(samples),
        scored_count=len(scores),
        metrics=[
            MetricReport(
                name="faithfulness",
                score=mean(score.faithfulness for score in scores),
                threshold=thresholds.faithfulness,
            ),
            MetricReport(
                name="context_relevance",
                score=mean(score.context_relevance for score in scores),
                threshold=thresholds.context_relevance,
            ),
            MetricReport(
                name="answer_correctness",
                score=mean(score.answer_correctness for score in scores),
                threshold=thresholds.answer_correctness,
            ),
        ],
        injection=evaluate_injection_set(
            injection_set, injection_outcomes, thresholds.injection_pass_rate
        ),
        sample_scores=scores,
        unanswered=unanswered,
        dataset_errors=dataset_errors,
    )


def render_report(report: GateReport) -> str:
    """Renders the gate report for a CI log."""
    lines = [
        f"RAG evaluation gate ({report.mode} mode, "
        f"{report.scored_count} of {report.sample_count} samples scored)",
        "",
    ]
    for metric in report.metrics:
        status = "PASS" if metric.passed else "FAIL"
        lines.append(
            f"  [{status}] {metric.name:18s} {metric.score:.3f} "
            f"(minimum {metric.threshold:.2f})"
        )

    injection = report.injection
    status = "PASS" if injection.passed else "FAIL"
    lines.append(
        f"  [{status}] {'prompt_injection':18s} "
        f"{injection.passed_count}/{injection.total} "
        f"({injection.pass_rate:.3f}, minimum {injection.threshold:.2f})"
    )

    unanswered_status = "PASS" if not report.unanswered else "FAIL"
    lines.append(
        f"  [{unanswered_status}] {'answered':18s} "
        f"{report.scored_count}/{report.sample_count} golden questions answered"
    )

    if report.dataset_errors:
        lines.append("")
        lines.append("Dataset errors:")
        lines.extend(f"  - {error}" for error in report.dataset_errors)

    if report.unanswered:
        lines.append("")
        lines.append("Unanswered golden questions:")
        lines.extend(f"  - {entry.id} [{entry.reason}]" for entry in report.unanswered)

    failed_cases = [result for result in injection.results if not result.passed]
    if failed_cases:
        lines.append("")
        lines.append("Failed prompt-injection cases:")
        lines.extend(
            f"  - {result.id} [{result.vector}]: {failure}"
            for result in failed_cases
            for failure in result.failures
        )

    if not report.passed:
        lines.append("")
        lines.append("Gate failed:")
        lines.extend(f"  - {reason}" for reason in report.failures)

    return "\n".join(lines)


def _resolve_mode(requested: str | None) -> EvaluationMode:
    """Resolves the scoring mode from the flag or the environment."""
    mode = requested or os.environ.get("RAG_EVAL_MODE", "deterministic")
    if mode == "deterministic":
        return "deterministic"
    if mode == "live":
        return "live"

    raise ValueError(
        f"Unknown evaluation mode {mode!r}; expected 'deterministic' or 'live'."
    )


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m evaluation.rag",
        description="Score the policy RAG assistant and enforce the CI thresholds.",
    )
    parser.add_argument("--samples", type=Path, default=DEFAULT_SAMPLES_PATH)
    parser.add_argument(
        "--injection-results", type=Path, default=DEFAULT_INJECTION_RESULTS_PATH
    )
    parser.add_argument(
        "--injection-set", type=Path, default=DEFAULT_INJECTION_SET_PATH
    )
    parser.add_argument(
        "--question-set",
        type=Path,
        default=DEFAULT_QUESTION_SET_PATH,
        help="Question set the samples must cover exactly once each.",
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--mode", choices=("deterministic", "live"), default=None)
    parser.add_argument(
        "--min-faithfulness",
        type=float,
        default=GateThresholds().faithfulness,
        help="Minimum mean faithfulness required to pass.",
    )
    parser.add_argument(
        "--min-context-relevance",
        type=float,
        default=GateThresholds().context_relevance,
        help="Minimum mean context relevance required to pass.",
    )
    parser.add_argument(
        "--min-answer-correctness",
        type=float,
        default=GateThresholds().answer_correctness,
        help="Minimum mean answer correctness required to pass.",
    )
    parser.add_argument(
        "--min-injection-pass-rate",
        type=float,
        default=GateThresholds().injection_pass_rate,
        help="Minimum prompt-injection pass rate required to pass.",
    )

    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """Runs the gate and returns the process exit code."""
    args = _parse_args(argv)

    try:
        mode = _resolve_mode(args.mode)
        thresholds = GateThresholds(
            faithfulness=args.min_faithfulness,
            context_relevance=args.min_context_relevance,
            answer_correctness=args.min_answer_correctness,
            injection_pass_rate=args.min_injection_pass_rate,
        )
        report = build_report(
            load_samples(args.samples),
            load_injection_set(args.injection_set),
            load_injection_outcomes(args.injection_results),
            thresholds,
            mode,
            load_expected_question_ids(args.question_set),
        )
    except (FileNotFoundError, ValidationError, ValueError) as error:
        sys.stderr.write(f"RAG evaluation gate could not run: {error}\n")
        return 2

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf8")
    sys.stdout.write(render_report(report) + "\n")

    return 0 if report.passed else 1
