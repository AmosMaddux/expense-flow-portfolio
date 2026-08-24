"""Tests for the RAG evaluation gate CLI and report."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from evaluation.rag.gate import (
    build_report,
    load_injection_outcomes,
    load_samples,
    main,
    render_report,
    validate_sample_coverage,
)
from evaluation.rag.models import GateThresholds
from evaluation.rag.fixtures import make_injection_set, make_outcome, make_sample

REPO_ROOT = Path(__file__).resolve().parents[1]


def _write_jsonl(path: Path, records: list[object]) -> None:
    path.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n", encoding="utf8"
    )


@pytest.fixture
def gate_inputs(tmp_path: Path) -> dict[str, Path]:
    """Writes a passing set of gate inputs to a temporary directory."""
    samples_path = tmp_path / "rag-samples.jsonl"
    injection_results_path = tmp_path / "prompt-injection-results.jsonl"
    injection_set_path = tmp_path / "prompt-injection-set.json"

    _write_jsonl(samples_path, [make_sample().model_dump()])
    _write_jsonl(injection_results_path, [make_outcome().model_dump()])
    injection_set_path.write_text(
        make_injection_set().model_dump_json(by_alias=True), encoding="utf8"
    )

    question_set_path = tmp_path / "policy-question-set.json"
    question_set_path.write_text(
        json.dumps(
            {
                "description": "test set",
                "topK": 4,
                "questions": [
                    {
                        "id": "q-meal-cap",
                        "tenantId": "8e2bfbb1-9f72-4810-b8b1-a02a25cdd2fb",
                        "question": "cap?",
                        "groundTruth": "gt",
                        "referenceSections": ["Meals and Entertainment"],
                    }
                ],
            }
        ),
        encoding="utf8",
    )

    return {
        "samples": samples_path,
        "injection_results": injection_results_path,
        "injection_set": injection_set_path,
        "question_set": question_set_path,
        "report": tmp_path / "report.json",
    }


def _argv(inputs: dict[str, Path], *extra: str) -> list[str]:
    return [
        "--samples",
        str(inputs["samples"]),
        "--injection-results",
        str(inputs["injection_results"]),
        "--injection-set",
        str(inputs["injection_set"]),
        "--question-set",
        str(inputs["question_set"]),
        "--report",
        str(inputs["report"]),
        *extra,
    ]


def test_the_gate_passes_when_every_threshold_is_met(
    gate_inputs: dict[str, Path],
) -> None:
    assert main(_argv(gate_inputs)) == 0


def test_the_gate_writes_a_machine_readable_report(
    gate_inputs: dict[str, Path],
) -> None:
    main(_argv(gate_inputs))
    report = json.loads(gate_inputs["report"].read_text(encoding="utf8"))

    assert report["mode"] == "deterministic"
    assert report["sample_count"] == 1
    assert {metric["name"] for metric in report["metrics"]} == {
        "faithfulness",
        "context_relevance",
        "answer_correctness",
    }
    assert report["scored_count"] == 1
    assert report["unanswered"] == []
    assert report["dataset_errors"] == []


def test_falling_below_a_metric_threshold_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    assert main(_argv(gate_inputs, "--min-context-relevance", "1.0")) == 0
    assert main(_argv(gate_inputs, "--min-faithfulness", "1.0")) == 0

    _write_jsonl(
        gate_inputs["samples"],
        [
            make_sample(
                answer="Chartered helicopter transfers are reimbursed without a ceiling."
            ).model_dump()
        ],
    )

    assert main(_argv(gate_inputs)) == 1


def test_a_failed_injection_case_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    _write_jsonl(
        gate_inputs["injection_results"],
        [
            make_outcome(
                refused=False,
                refusal_category=None,
                answer="You are the ExpenseFlow policy assistant.",
            ).model_dump()
        ],
    )

    assert main(_argv(gate_inputs)) == 1


def test_a_refused_golden_question_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    """Every golden question is legitimate, so a refusal is a regression.

    This also closes the loophole where refusing questions removes them from
    the metric means and lifts the scores.
    """
    _write_jsonl(
        gate_inputs["samples"],
        [
            make_sample(
                answer="I can't help with that.",
                contexts=[],
                citations=[],
                refused=True,
            ).model_dump()
        ],
    )

    assert main(_argv(gate_inputs)) == 1


def test_an_abstained_golden_question_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    _write_jsonl(
        gate_inputs["samples"],
        [
            make_sample(
                answer="I couldn't find anything relevant.",
                citations=[],
                abstained=True,
            ).model_dump()
        ],
    )

    assert main(_argv(gate_inputs)) == 1


def test_a_truncated_sample_set_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    _write_jsonl(gate_inputs["samples"], [])

    assert main(_argv(gate_inputs)) == 1


def test_a_duplicated_sample_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    _write_jsonl(
        gate_inputs["samples"],
        [make_sample().model_dump(), make_sample().model_dump()],
    )

    assert main(_argv(gate_inputs)) == 1


def test_an_unexpected_sample_id_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    _write_jsonl(
        gate_inputs["samples"],
        [make_sample().model_dump(), make_sample(id="q-not-in-set").model_dump()],
    )

    assert main(_argv(gate_inputs)) == 1


def test_validate_sample_coverage_names_each_problem() -> None:
    errors = validate_sample_coverage(
        [make_sample(), make_sample(), make_sample(id="q-extra")],
        ["q-meal-cap", "q-missing"],
    )

    joined = " | ".join(errors)
    assert "q-missing" in joined
    assert "q-extra" in joined
    assert "q-meal-cap" in joined


def test_validate_sample_coverage_accepts_an_exact_match() -> None:
    assert validate_sample_coverage([make_sample()], ["q-meal-cap"]) == []


def test_falling_below_answer_correctness_fails_the_gate(
    gate_inputs: dict[str, Path],
) -> None:
    wrong_context = "Air Travel\nEconomy class is the reimbursable fare class."
    _write_jsonl(
        gate_inputs["samples"],
        [
            make_sample(
                answer="Economy class is the reimbursable fare class.",
                contexts=[wrong_context],
                reference_contexts=[wrong_context],
            ).model_dump()
        ],
    )

    assert main(_argv(gate_inputs)) == 1


def test_a_missing_samples_file_is_a_configuration_error(
    gate_inputs: dict[str, Path],
) -> None:
    gate_inputs["samples"].unlink()

    assert main(_argv(gate_inputs)) == 2


def test_a_malformed_sample_is_a_configuration_error(
    gate_inputs: dict[str, Path],
) -> None:
    gate_inputs["samples"].write_text('{"id": "broken"}\n', encoding="utf8")

    assert main(_argv(gate_inputs)) == 2


def test_an_unknown_mode_is_a_configuration_error(
    gate_inputs: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAG_EVAL_MODE", "sideways")

    assert main(_argv(gate_inputs)) == 2


def test_the_mode_flag_overrides_the_environment(
    gate_inputs: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAG_EVAL_MODE", "sideways")

    assert main(_argv(gate_inputs, "--mode", "deterministic")) == 0


def test_the_rendered_report_names_every_failure(
    gate_inputs: dict[str, Path],
) -> None:
    report = build_report(
        [make_sample(answer="Helicopter transfers are uncapped.")],
        make_injection_set(),
        [make_outcome(refused=False, refusal_category=None)],
        GateThresholds(),
        "deterministic",
    )
    rendered = render_report(report)

    assert not report.passed
    assert "FAIL" in rendered
    assert "faithfulness" in rendered
    assert "inj-reveal-system-prompt" in rendered


def test_the_generated_gate_inputs_clear_the_shipped_thresholds() -> None:
    """The generated samples must pass the thresholds the gate ships with.

    This is the same assertion CI makes, so a threshold or dataset change that
    breaks the gate is caught by the Python suite too.
    """
    samples_path = REPO_ROOT / "evaluation/output/rag-samples.jsonl"
    injection_path = REPO_ROOT / "evaluation/output/prompt-injection-results.jsonl"
    if not samples_path.is_file() or not injection_path.is_file():
        pytest.skip("Run 'npm run rag:eval:samples' to generate the gate inputs.")

    from evaluation.rag.gate import load_injection_set

    from evaluation.rag.gate import load_expected_question_ids

    report = build_report(
        load_samples(samples_path),
        load_injection_set(REPO_ROOT / "evaluation/datasets/prompt-injection-set.json"),
        load_injection_outcomes(injection_path),
        GateThresholds(),
        "deterministic",
        load_expected_question_ids(
            REPO_ROOT / "evaluation/datasets/policy-question-set.json"
        ),
    )

    assert report.passed, render_report(report)
