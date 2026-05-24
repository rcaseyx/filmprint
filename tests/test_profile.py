"""Tests for filmprint/profile.py — pure functions only."""

import pytest
from filmprint.profile import personal_neutral


def test_personal_neutral_typical():
    # Mean of 3.5 → neutral = 3.0 (clamped max)
    ratings = [3.0, 4.0, 4.0, 3.0]
    assert personal_neutral(ratings) == 3.0


def test_personal_neutral_generous_rater():
    # Mean of 4.5 → 4.5 - 0.5 = 4.0, clamped to 3.0
    ratings = [4.0, 5.0, 5.0, 4.0]
    assert personal_neutral(ratings) == 3.0


def test_personal_neutral_harsh_rater():
    # Mean of 2.0 → 2.0 - 0.5 = 1.5 (hits lower clamp)
    ratings = [1.0, 2.0, 2.0, 3.0]
    assert personal_neutral(ratings) == pytest.approx(1.5)


def test_personal_neutral_very_harsh():
    # Mean of 1.0 → 0.5, clamped to 1.5
    ratings = [1.0, 1.0, 1.0]
    assert personal_neutral(ratings) == 1.5


def test_personal_neutral_empty():
    assert personal_neutral([]) == 3.0


def test_personal_neutral_single_rating():
    # Mean of 3.0 → 2.5
    assert personal_neutral([3.0]) == 2.5


def test_personal_neutral_clamped_below():
    assert personal_neutral([1.0]) == 1.5


def test_personal_neutral_clamped_above():
    assert personal_neutral([5.0, 5.0, 5.0]) == 3.0
