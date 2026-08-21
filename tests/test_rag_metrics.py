"""Tests for the deterministic RAGAS metric implementations."""

from __future__ import annotations

from evaluation.rag.metrics import (
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


def test_a_refusal_makes_no_policy_claim_and_is_faithful() -> None:
    sample = make_sample(
        answer="I can't read another tenant's policy.",
        contexts=[],
        refused=True,
    )

    assert faithfulness(sample) == 1.0


def test_an_abstention_makes_no_policy_claim_and_is_faithful() -> None:
    sample = make_sample(
        answer="I couldn't find anything in your workspace's expense policy.",
        abstained=True,
    )

    assert faithfulness(sample) == 1.0


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


def test_a_refusal_retrieves_no_irrelevant_context() -> None:
    sample = make_sample(answer="I can't do that.", contexts=[], refused=True)

    assert context_relevance(sample) == 1.0


def test_an_abstention_is_still_scored_on_retrieval_quality() -> None:
    sample = make_sample(
        answer="I couldn't find anything relevant.",
        contexts=["Mileage\nUnrelated mileage text."],
        abstained=True,
    )

    assert context_relevance(sample) == 0.0


def test_score_samples_reports_both_metrics_per_sample() -> None:
    scores = score_samples([make_sample(), make_sample(id="q-second")])

    assert [score.id for score in scores] == ["q-meal-cap", "q-second"]
    assert all(score.faithfulness == 1.0 for score in scores)


def test_tokenize_drops_stop_words_and_short_tokens() -> None:
    assert tokenize("What is the meal cap of a day") == {"meal", "cap", "day"}


def test_split_sentences_splits_on_terminators_and_newlines() -> None:
    assert split_sentences("One. Two!\nThree?") == ["One.", "Two!", "Three?"]


def test_mean_of_an_empty_sequence_is_zero() -> None:
    assert mean([]) == 0.0
    assert mean([1.0, 0.0]) == 0.5
