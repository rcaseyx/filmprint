"""Tests for filmprint/recommender.py — all pure functions, no I/O."""

import numpy as np

from filmprint.features import build_feature_vector
from filmprint.recommender import rank_watchlist
from tests.conftest import make_movie


def _profile_matching(movie: dict) -> np.ndarray:
    """A taste profile identical to one movie's own feature vector, so that
    movie scores a perfect (or near-perfect) cosine match before any penalty."""
    return build_feature_vector(movie)


def test_watchlist_penalty_down_weights_watchlist_candidates():
    watchlist_movie = make_movie(tmdb_id=1, title="On Watchlist", genres=["Drama"])
    novel_movie = make_movie(tmdb_id=2, title="Not Seen Before", genres=["Drama"])
    profile = _profile_matching(watchlist_movie)

    ranked = rank_watchlist(
        profile,
        [watchlist_movie, novel_movie],
        watchlist_ids={1},
        watchlist_penalty=0.6,
    )
    scores = {m["id"]: s for m, s in ranked}

    assert scores[1] == scores[2] * 0.4  # penalty applied identically before comparison


def test_watchlist_penalty_can_flip_ranking():
    # Same underlying taste match, but movie 1 is on the watchlist.
    watchlist_movie = make_movie(tmdb_id=1, title="On Watchlist", genres=["Drama"])
    novel_movie = make_movie(tmdb_id=2, title="Not Seen Before", genres=["Drama"])
    profile = _profile_matching(watchlist_movie)

    unpenalized = rank_watchlist(profile, [watchlist_movie, novel_movie])
    assert unpenalized[0][0]["id"] == 1  # tied scores, first candidate wins the tie

    penalized = rank_watchlist(
        profile,
        [watchlist_movie, novel_movie],
        watchlist_ids={1},
        watchlist_penalty=0.6,
    )
    assert penalized[0][0]["id"] == 2  # novel discovery now outranks the watchlist item


def test_watchlist_penalty_noop_when_zero_or_unset():
    watchlist_movie = make_movie(tmdb_id=1, genres=["Drama"])
    novel_movie = make_movie(tmdb_id=2, genres=["Comedy"])
    profile = _profile_matching(watchlist_movie)

    baseline = rank_watchlist(profile, [watchlist_movie, novel_movie])
    with_zero_penalty = rank_watchlist(
        profile, [watchlist_movie, novel_movie], watchlist_ids={1}, watchlist_penalty=0.0
    )
    with_no_ids = rank_watchlist(
        profile, [watchlist_movie, novel_movie], watchlist_penalty=0.6
    )

    baseline_scores = [s for _, s in baseline]
    assert [s for _, s in with_zero_penalty] == baseline_scores
    assert [s for _, s in with_no_ids] == baseline_scores


def test_watchlist_penalty_leaves_non_watchlist_scores_unchanged():
    watchlist_movie = make_movie(tmdb_id=1, genres=["Drama"])
    other_watchlist_movie = make_movie(tmdb_id=2, genres=["Comedy"])
    novel_movie = make_movie(tmdb_id=3, genres=["Horror"])
    profile = _profile_matching(watchlist_movie)

    baseline = dict(
        (m["id"], s) for m, s in rank_watchlist(profile, [watchlist_movie, other_watchlist_movie, novel_movie])
    )
    penalized = dict(
        (m["id"], s)
        for m, s in rank_watchlist(
            profile,
            [watchlist_movie, other_watchlist_movie, novel_movie],
            watchlist_ids={1, 2},
            watchlist_penalty=0.6,
        )
    )

    assert penalized[3] == baseline[3]
    assert penalized[1] == baseline[1] * 0.4
    assert penalized[2] == baseline[2] * 0.4
