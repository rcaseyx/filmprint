"""Tests for filmprint/features.py — all pure functions, no I/O."""

import pytest
from filmprint.features import (
    GENRES,
    SUBGENRE_AXES,
    TONE_AXES,
    _axis_vector,
    _decade_vector,
    _genre_vector,
    _movie_keywords,
    _runtime_vector,
    _score_vector,
    build_affinity_scores,
    build_keyword_vocab,
    compute_axis_scores,
)
from tests.conftest import make_movie


# --- _genre_vector ---

def test_genre_vector_known_genre():
    movie = make_movie(genres=["Drama"])
    vec = _genre_vector(movie)
    assert len(vec) == len(GENRES)
    assert vec[GENRES.index("Drama")] == 1.0
    assert vec[GENRES.index("Horror")] == 0.0


def test_genre_vector_multi_genre():
    movie = make_movie(genres=["Drama", "Horror"])
    vec = _genre_vector(movie)
    assert vec[GENRES.index("Drama")] == 1.0
    assert vec[GENRES.index("Horror")] == 1.0


def test_genre_vector_unknown_genre_ignored():
    movie = make_movie(genres=["NotARealGenre"])
    vec = _genre_vector(movie)
    assert sum(vec) == 0.0


# --- _decade_vector ---

def test_decade_vector_2010s():
    movie = make_movie(year=2013)
    vec = _decade_vector(movie)
    from filmprint.features import DECADES
    assert vec[DECADES.index("2010s")] == 1.0
    assert sum(vec) == 1.0


def test_decade_vector_boundary_2000s():
    movie = make_movie(year=2000)
    vec = _decade_vector(movie)
    from filmprint.features import DECADES
    assert vec[DECADES.index("2000s")] == 1.0


def test_decade_vector_out_of_range():
    movie = make_movie(year=1930)
    vec = _decade_vector(movie)
    assert sum(vec) == 0.0


# --- _runtime_vector ---

def test_runtime_short():
    vec = _runtime_vector(make_movie(runtime=80))
    assert vec == [1.0, 0.0, 0.0, 0.0]


def test_runtime_standard():
    vec = _runtime_vector(make_movie(runtime=100))
    assert vec == [0.0, 1.0, 0.0, 0.0]


def test_runtime_long():
    vec = _runtime_vector(make_movie(runtime=135))
    assert vec == [0.0, 0.0, 1.0, 0.0]


def test_runtime_very_long():
    vec = _runtime_vector(make_movie(runtime=180))
    assert vec == [0.0, 0.0, 0.0, 1.0]


# --- _score_vector ---

def test_score_vector_normalised():
    movie = make_movie(vote_average=8.0)
    assert _score_vector(movie) == [0.8]


def test_score_vector_zero():
    movie = make_movie(vote_average=0.0)
    assert _score_vector(movie) == [0.0]


# --- _movie_keywords ---

def test_movie_keywords_nested_dict():
    movie = make_movie(keywords=["neo-noir", "detective"])
    kws = _movie_keywords(movie)
    assert "neo-noir" in kws
    assert "detective" in kws


def test_movie_keywords_empty():
    movie = make_movie(keywords=[])
    assert _movie_keywords(movie) == set()


def test_movie_keywords_flat_list_fallback():
    """Keywords stored as a plain list on the top-level movie dict."""
    movie = {"id": 1, "title": "X", "raw_tmdb": {}, "keywords": ["heist", "caper"]}
    kws = _movie_keywords(movie)
    assert "heist" in kws


# --- _axis_vector ---

def test_axis_vector_full_match():
    axes = {"Neo-noir": ["neo-noir", "detective"]}
    movie = make_movie(keywords=["neo-noir", "detective"])
    vec = _axis_vector(movie, axes)
    assert vec == [1.0]


def test_axis_vector_partial_match():
    axes = {"Neo-noir": ["neo-noir", "detective", "film noir"]}
    movie = make_movie(keywords=["neo-noir"])
    vec = _axis_vector(movie, axes)
    assert round(vec[0], 4) == round(1 / 3, 4)


def test_axis_vector_no_match():
    axes = {"Heist": ["heist", "robbery"]}
    movie = make_movie(keywords=["neo-noir"])
    assert _axis_vector(movie, axes) == [0.0]


# --- build_keyword_vocab ---

def test_build_keyword_vocab_top_k():
    movies = [
        make_movie(keywords=["neo-noir", "detective"]),
        make_movie(keywords=["neo-noir", "heist"]),
        make_movie(keywords=["heist"]),
    ]
    vocab = build_keyword_vocab(movies, top_k=2)
    assert vocab[0] in {"neo-noir", "heist"}
    assert len(vocab) == 2


def test_build_keyword_vocab_empty():
    assert build_keyword_vocab([]) == []


# --- compute_axis_scores ---

def test_compute_axis_scores_ordering():
    axes = {"Neo-noir": ["neo-noir", "detective"], "Heist": ["heist", "robbery"]}
    movies = [
        make_movie(tmdb_id=1, keywords=["neo-noir", "detective"]),
        make_movie(tmdb_id=2, keywords=["heist"]),
    ]
    ratings = [5.0, 3.0]
    results = compute_axis_scores(movies, ratings, axes)
    names = [r["name"] for r in results]
    # Neo-noir had both keywords matched by the higher-rated film — should rank first
    assert names[0] == "Neo-noir"


def test_compute_axis_scores_normalised_to_one():
    axes = {"Dark": TONE_AXES["Dark"], "Warm": TONE_AXES["Warm"]}
    movies = [make_movie(keywords=["neo-noir", "gore", "paranoia"])]
    results = compute_axis_scores(movies, [5.0], axes)
    weights = [r["weight"] for r in results]
    assert max(weights) == 1.0


def test_compute_axis_scores_no_ratings():
    results = compute_axis_scores([], [], SUBGENRE_AXES)
    assert all(r["weight"] == 0.0 for r in results)


# --- build_affinity_scores ---

def test_build_affinity_scores_director():
    movies = [
        make_movie(tmdb_id=1, director="Wes Anderson"),
        make_movie(tmdb_id=2, director="Wes Anderson"),
        make_movie(tmdb_id=3, director="Denis Villeneuve"),
    ]
    ratings = [5.0, 4.0, 3.0]
    affinity = build_affinity_scores(movies, ratings)
    assert "Wes Anderson" in affinity["directors"]
    assert affinity["directors"]["Wes Anderson"] == pytest.approx(4.5)
    assert affinity["directors"]["Denis Villeneuve"] == pytest.approx(3.0)
