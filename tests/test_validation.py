"""Unit tests for the data-quality checks (step 5)."""
import pandas as pd
import pytest
import validation as v


def df(rows):
    return pd.DataFrame(rows)


# --- years complete ---

def test_years_complete_pass():
    d = df([
        {"LocationDesc": "Texas", "YearStart": 2011},
        {"LocationDesc": "Texas", "YearStart": 2012},
        {"LocationDesc": "Ohio", "YearStart": 2011},
        {"LocationDesc": "Ohio", "YearStart": 2012},
    ])
    v.check_years_complete(d, n_years=2)  # should not raise


def test_years_complete_fail():
    d = df([
        {"LocationDesc": "Texas", "YearStart": 2011},
        {"LocationDesc": "Ohio", "YearStart": 2011},
        {"LocationDesc": "Ohio", "YearStart": 2012},
    ])
    with pytest.raises(AssertionError):
        v.check_years_complete(d, n_years=2)


# --- duplicates ---

def test_no_duplicates_pass():
    d = df([
        {"LocationDesc": "Texas", "YearStart": 2011, "Question": "q",
         "StratificationCategory1": "Total", "Stratification1": "Total"},
        {"LocationDesc": "Texas", "YearStart": 2012, "Question": "q",
         "StratificationCategory1": "Total", "Stratification1": "Total"},
    ])
    v.check_no_duplicates(d)


def test_no_duplicates_fail():
    row = {"LocationDesc": "Texas", "YearStart": 2011, "Question": "q",
           "StratificationCategory1": "Total", "Stratification1": "Total"}
    d = df([row, dict(row)])
    with pytest.raises(AssertionError):
        v.check_no_duplicates(d)


# --- value range ---

def test_value_range_pass_with_nan():
    d = df([{"Data_Value_Num": 50.0}, {"Data_Value_Num": None}, {"Data_Value_Num": 0.0}])
    v.check_value_range(d)


def test_value_range_fail_high():
    d = df([{"Data_Value_Num": 50.0}, {"Data_Value_Num": 150.0}])
    with pytest.raises(AssertionError):
        v.check_value_range(d)


def test_value_range_fail_negative():
    d = df([{"Data_Value_Num": -1.0}])
    with pytest.raises(AssertionError):
        v.check_value_range(d)


# --- location count ---

def test_location_count():
    d = df([{"LocationDesc": "Texas"}, {"LocationDesc": "Ohio"}])
    v.check_location_count(d, expected=2)
    with pytest.raises(AssertionError):
        v.check_location_count(d, expected=51)


# --- categories ---

def test_categories_pass_subset():
    d = df([{"StratificationCategory1": "Total"}, {"StratificationCategory1": "Sex"}])
    v.check_categories(d)


def test_categories_fail_unexpected():
    d = df([{"StratificationCategory1": "Weird"}])
    with pytest.raises(AssertionError):
        v.check_categories(d)
