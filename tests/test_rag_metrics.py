"""Tests for the deterministic RAGAS metric implementations."""

from __future__ import annotations

from evaluation.rag.metrics import (
    answer_correctness,
    context_relevance,
    faithfulness,
    mean,
    score_samples,
    split_sentences,
    tokenize,
)
from evaluation.rag.fixtures import CONTEXT, GROUND_TRUTH, make_sample


def test_faithfulness_scores_an_extractive_answer_as_fully_supported() -> None:
    assert faithfulness(make_sample()) == 1.0


def test_faithfulness_penalises_a_claim_the_context_does_not_carry() -> None:
    sample = make_sample(
        answer=(
            "Employee meals during approved business travel are reimbursed up "
            "to 75 dollars per person per day. Chartered helicopter transfers "
            "are reimbursed without any documented ceiling."
        )
    )

    assert faithfulness(sample) == 0.5


def test_faithfulness_is_zero_when_no_claim_is_supported() -> None:
    sample = make_sample(
        answer="Chartered helicopter transfers are reimbursed without a ceiling."
    )

    assert faithfulness(sample) == 0.0


def test_faithfulness_is_zero_without_any_retrieved_context() -> None:
    assert faithfulness(make_sample(contexts=[])) == 0.0


def test_the_citation_tail_is_not_scored_as_a_claim() -> None:
    with_citation = make_sample()
    without_citation = make_sample(answer=GROUND_TRUTH)

    assert faithfulness(with_citation) == faithfulness(without_citation) == 1.0


def test_context_relevance_is_one_when_the_reference_ranks_first() -> None:
    assert context_relevance(make_sample()) == 1.0


def test_context_relevance_falls_when_the_reference_is_ranked_lower() -> None:
    sample = make_sample(contexts=["Mileage\nUnrelated mileage text.", CONTEXT])

    assert context_relevance(sample) == 0.5


def test_context_relevance_is_zero_when_the_reference_is_missed() -> None:
    sample = make_sample(contexts=["Mileage\nUnrelated mileage text."])

    assert context_relevance(sample) == 0.0


def test_context_relevance_is_zero_without_any_retrieved_context() -> None:
    assert context_relevance(make_sample(contexts=[])) == 0.0


def test_a_refusal_is_no_longer_scored_as_perfect() -> None:
    """Refusals must not short-circuit to 1.0.

    The gate excludes them from the means and fails them separately; if they
    were scored here instead, an over-refusing assistant would look perfect.
    """
    sample = make_sample(
        answer="I can't read another tenant's policy.",
        contexts=[],
        refused=True,
    )

    assert faithfulness(sample) == 0.0
    assert context_relevance(sample) == 0.0
    assert answer_correctness(sample) == 0.0


def test_answer_correctness_is_one_when_the_answer_states_the_ground_truth() -> None:
    assert answer_correctness(make_sample()) == 1.0


def test_answer_correctness_falls_when_the_answer_misses_the_ground_truth() -> None:
    sample = make_sample(
        answer="Mileage is reimbursed at 67 cents per mile.",
        contexts=["Mileage\nMileage is reimbursed at 67 cents per mile."],
    )

    assert answer_correctness(sample) < 0.5


def test_answer_correctness_is_not_satisfied_by_copying_unrelated_context() -> None:
    """This is what separates correctness from faithfulness.

    Quoting a retrieved chunk verbatim always satisfies faithfulness, so only
    correctness moves when retrieval surfaces the wrong section.
    """
    wrong_context = "Air Travel\nEconomy class is the reimbursable fare class."
    sample = make_sample(
        answer="Economy class is the reimbursable fare class.",
        contexts=[wrong_context],
        reference_contexts=[wrong_context],
    )

    assert faithfulness(sample) == 1.0
    assert answer_correctness(sample) < 0.3


def test_score_samples_reports_every_metric_per_sample() -> None:
    scores = score_samples([make_sample(), make_sample(id="q-second")])

    assert [score.id for score in scores] == ["q-meal-cap", "q-second"]
    assert all(score.faithfulness == 1.0 for score in scores)
    assert all(score.answer_correctness == 1.0 for score in scores)


def test_tokenize_drops_stop_words_and_short_tokens() -> None:
    assert tokenize("What is the meal cap of a day") == {"meal", "cap", "day"}


def test_split_sentences_splits_on_terminators_and_newlines() -> None:
    assert split_sentences("One. Two!\nThree?") == ["One.", "Two!", "Three?"]


def test_mean_of_an_empty_sequence_is_zero() -> None:
    assert mean([]) == 0.0
    assert mean([1.0, 0.0]) == 0.5
