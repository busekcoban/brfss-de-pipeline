"""
Data-quality checks (step 5), extracted from pipeline.validate() so they
can be unit-tested and reused as a quality gate.

Each check raises AssertionError with a clear message on failure, or
returns None on success. run_all() runs the full suite.
"""
import pandas as pd

EXPECTED_YEARS = 14
EXPECTED_LOCATIONS = 51
EXPECTED_CATEGORIES = {"Total", "Sex", "Income", "Education", "Race/Ethnicity", "Age (years)"}


def check_years_complete(df: pd.DataFrame, n_years: int = EXPECTED_YEARS) -> None:
    yr = df.groupby("LocationDesc")["YearStart"].nunique()
    bad = yr[yr != n_years]
    assert bad.empty, f"States without {n_years} years: {bad.to_dict()}"


def check_no_duplicates(df: pd.DataFrame) -> None:
    keys = ["LocationDesc", "YearStart", "Question", "StratificationCategory1", "Stratification1"]
    dup = df.duplicated(subset=keys).sum()
    assert dup == 0, f"{dup} duplicate rows"


def check_value_range(df: pd.DataFrame, col: str = "Data_Value_Num", lo: float = 0, hi: float = 100) -> None:
    v = df[col].dropna()
    bad = v[(v < lo) | (v > hi)]
    assert bad.empty, f"{len(bad)} values outside [{lo}, {hi}]"


def check_location_count(df: pd.DataFrame, expected: int = EXPECTED_LOCATIONS) -> None:
    n = df["LocationDesc"].nunique()
    assert n == expected, f"Expected {expected} locations, got {n}"


def check_categories(df: pd.DataFrame, expected=EXPECTED_CATEGORIES) -> None:
    cats = set(df["StratificationCategory1"].unique())
    extra = cats - expected
    assert not extra, f"Unexpected stratification categories: {extra}"


def run_all(df: pd.DataFrame) -> None:
    check_years_complete(df)
    check_no_duplicates(df)
    check_value_range(df)
    check_location_count(df)
    check_categories(df)
    print("  All data-quality checks passed.")
