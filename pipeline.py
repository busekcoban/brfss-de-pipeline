"""
Data pipeline for the CDC BRFSS dataset.
Does: load -> clean -> validate -> engineer -> mine.

Usage: python pipeline.py
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import bq
import config
import validation

RAW = Path("data/Nutrition_Physical_Activity_Obesity.csv")
CLEANED = Path("data/brfss_cleaned.csv")
INTERPOLATED = Path("data/brfss_interpolated.csv")
FEATURES = Path("data/brfss_features.csv")

# Locations we don't want (no GeoLocation data or aggregate)
EXCLUDE = ["National", "Guam", "Puerto Rico", "Virgin Islands"]
# Columns that are almost entirely empty
DROP = ["Data_Value_Unit", "Total", "Data_Value_Alt", "Data_Value_Type", "Datasource"]

QUESTION_MAP = {
    "obesity_rate":        "Percent of adults aged 18 years and older who have obesity",
    "overweight_rate":     "Percent of adults aged 18 years and older who have an overweight classification",
    "pa_150_rate":         "Percent of adults who achieve at least 150 minutes a week of moderate-intensity aerobic physical activity or 75 minutes a week of vigorous-intensity aerobic activity (or a combination) and 2 days a week of muscle-strengthening activities",
    "pa_300_rate":         "Percent of adults who achieve more than 300 minutes a week of moderate-intensity aerobic physical activity or 150 minutes a week of vigorous-intensity aerobic physical activity and 2 days a week of muscle-strengthening",
    "pa_strength_rate":    "Percent of adults who engage in muscle-strengthening activities on 2 or more days a week",
    "pa_none_rate":        "Percent of adults who engage in no leisure-time physical activity",
    "fruit_less1_rate":    "Percent of adults who report consuming fruit less than one time daily",
    "vegetables_less1_rate":"Percent of adults who report consuming vegetables less than one time daily",
}

# US Census Bureau region assignment
REGIONS = {
    "Alabama":"South","Alaska":"West","Arizona":"West","Arkansas":"South",
    "California":"West","Colorado":"West","Connecticut":"Northeast","Delaware":"South",
    "District of Columbia":"South","Florida":"South","Georgia":"South","Hawaii":"West",
    "Idaho":"West","Illinois":"Midwest","Indiana":"Midwest","Iowa":"Midwest",
    "Kansas":"Midwest","Kentucky":"South","Louisiana":"South","Maine":"Northeast",
    "Maryland":"South","Massachusetts":"Northeast","Michigan":"Midwest",
    "Minnesota":"Midwest","Mississippi":"South","Missouri":"Midwest","Montana":"West",
    "Nebraska":"Midwest","Nevada":"West","New Hampshire":"Northeast",
    "New Jersey":"Northeast","New Mexico":"West","New York":"Northeast",
    "North Carolina":"South","North Dakota":"Midwest","Ohio":"Midwest",
    "Oklahoma":"South","Oregon":"West","Pennsylvania":"Northeast",
    "Rhode Island":"Northeast","South Carolina":"South","South Dakota":"Midwest",
    "Tennessee":"South","Texas":"South","Utah":"West","Vermont":"Northeast",
    "Virginia":"South","Washington":"West","West Virginia":"South",
    "Wisconsin":"Midwest","Wyoming":"West",
}


# --- Step 1: Load + profile ---

def load_and_profile():
    start = datetime.now()
    if not RAW.exists():
        raise SystemExit(
            f"Raw data file not found: {RAW}\n"
            "Download 'Nutrition, Physical Activity, and Obesity (BRFSS)' from\n"
            "https://chronicdata.cdc.gov, save it as that filename under data/, then re-run.")
    print("Loading CSV...")
    df = bq.read_table(config.RAW_TABLE)
    df["YearStart"] = df["YearStart"].astype("int16")
    df["YearEnd"] = df["YearEnd"].astype("int16")
    print(f"  {df.shape[0]:,} rows, {df.shape[1]} cols ({datetime.now()-start})")

    # Quick overview
    print(f"  Years: {df['YearStart'].min()}-{df['YearStart'].max()}")
    print(f"  Locations: {df['LocationDesc'].nunique()} (includes National + territories)")
    print(f"  Questions: {df['Question'].nunique()}")

    print("\n  Class distribution:")
    for v, c in df["Class"].value_counts().items():
        print(f"    {v}: {c:,}")

    print("\n  Stratification dimensions:")
    for v, c in df["StratificationCategory1"].value_counts().items():
        print(f"    {v}: {c:,}")

    print("\n  Columns with >50% missing:")
    missing_pct = (df.isna().sum() / len(df) * 100).round(1)
    for col, pct in missing_pct[missing_pct > 50].items():
        print(f"    {col}: {pct}%")

    # Sanity checks
    assert df["YearStart"].equals(df["YearEnd"]), "YearStart != YearEnd"
    assert df["Data_Value_Type"].nunique() == 1, "Data_Value_Type not constant"
    print("\n  Sanity checks passed.")

    return df


# --- Step 2: Clean ---

def clean(df, interpolate=False):
    print("\n--- Cleaning ---")

    # Prune columns
    df = df.drop(columns=[c for c in DROP if c in df.columns])
    print(f"  Dropped {len(DROP)} mostly-empty columns")

    # Remove non-state rows
    before = len(df)
    df = df[~df["LocationDesc"].isin(EXCLUDE)].reset_index(drop=True)
    print(f"  Removed {before - len(df):,} non-state rows -> {len(df):,} remain")

    # Parse values: CDC uses comma as decimal (e.g. "34,8")
    # and "-" footnote symbol when sample size is too small
    df["is_suppressed"] = df["Data_Value_Footnote_Symbol"] == "-"
    df["Data_Value_Num"] = pd.to_numeric(df["Data_Value"].astype(str).str.replace(",", "."), errors="coerce")
    # suppressed values have no number -> become NaN automatically
    print(f"  Numeric values: {df['Data_Value_Num'].notna().sum():,}")
    print(f"  Suppressed (NaN): {df['is_suppressed'].sum():,} ({df['is_suppressed'].sum()/len(df)*100:.1f}%)")

    # Clean up label whitespace
    df["StratificationCategory1"] = df["StratificationCategory1"].str.strip()
    df["Stratification1"] = df["Stratification1"].str.strip()

    # Interpolation for time-series views (proposal strategy)
    if interpolate:
        cols = ["LocationDesc","Question","StratificationCategory1","Stratification1"]
        df = df.sort_values(cols + ["YearStart"])
        before_nan = df["Data_Value_Num"].isna().sum()
        # linear interp within each group, max 3 consecutive gaps
        df["Data_Value_Num"] = df.groupby(cols)["Data_Value_Num"].transform(
            lambda x: x.interpolate(method="linear", limit_direction="both", limit=3))
        recovered = before_nan - df["Data_Value_Num"].isna().sum()
        print(f"  Interpolation recovered {recovered:,} values ({df['Data_Value_Num'].isna().sum():,} still NaN)")

    return df


# --- Step 3: Validate ---

def validate(df):
    print("\n--- Validation ---")
    validation.run_all(df)
    ok = 0

    # Every state has all 14 years?
    yr = df.groupby("LocationDesc")["YearStart"].nunique()
    assert (yr == 14).all(), f"Some states missing years: {yr[yr < 14].to_dict()}"
    ok += 1

    # No duplicate rows?
    dup = df.duplicated(subset=["LocationDesc","YearStart","Question","StratificationCategory1","Stratification1"]).sum()
    assert dup == 0, f"{dup} duplicate rows"
    ok += 1

    # Values in expected range?
    v = df["Data_Value_Num"].dropna()
    assert v.between(0, 100).all(), f"Value out of range: {v[v < 0].tolist()[:3]} {v[v > 100].tolist()[:3]}"
    ok += 1

    # 51 locations (states + DC)?
    assert df["LocationDesc"].nunique() == 51, f"Expected 51, got {df['LocationDesc'].nunique()}"
    ok += 1

    # Categories correct?
    cats = set(df["StratificationCategory1"].unique())
    expected = {"Total","Sex","Income","Education","Race/Ethnicity","Age (years)"}
    assert cats.issubset(expected), f"Unexpected cats: {cats - expected}"
    ok += 1

    print(f"  All {ok} checks passed.")


# --- Step 4: Feature engineering ---

def engineer():
    print("\n--- Feature Engineering ---")

    # Use interpolated dataset so suppressed state-years get filled (e.g. FL 2021)
    df = pd.read_csv(INTERPOLATED)
    df["YearStart"] = df["YearStart"].astype(int)

    # Map question strings -> short column names
    rev = {v:k for k,v in QUESTION_MAP.items()}
    df["metric"] = df["Question"].map(rev)
    unmapped = df[df["metric"].isna()]
    print(f"  Unmapped questions: {len(unmapped)} rows (dropping)")
    df = df.dropna(subset=["metric"])

    # Exclude "Data not reported" income rows (3,672 rows: valid obesity
    # values but unknown income bracket -- can't place on income gradient)
    ndr_mask = df["Stratification1"] == "Data not reported"
    if ndr_mask.sum():
        print(f"  Excluded {ndr_mask.sum():,} 'Data not reported' income rows (unknown income bracket)")
    df = df[~ndr_mask]

    # Pivot: each metric becomes its own column
    pivot_cols = ["LocationDesc","LocationAbbr","YearStart","StratificationCategory1","Stratification1"]
    pivoted = df.pivot_table(index=pivot_cols, columns="metric",
                             values="Data_Value_Num", aggfunc="mean").reset_index()

    features = [c for c in pivoted.columns if c in QUESTION_MAP]
    print(f"  Pivoted: {pivoted.shape[0]:,} rows, features: {features}")

    # Second imputation pass: group-level mean for sparse demographic cells
    # After interpolation, 147 Race/Ethnicity rows (0.8%) still have NaN
    # in core metrics. These are small subpopulations (e.g. NH/Pacific
    # Islander in Alaska) where CDC suppressed data even at the state
    # level. Fill with the demographic's national-level mean for that
    # year, which is a real measurement -- just one aggregation level up.
    # Fallback: group overall mean across all years if year-specific
    # mean is also unavailable.
    # Fruit/vegetable columns (~79% missing) are NOT imputed because
    # their missingness is structural -- those questions only exist for
    # certain stratification combinations, not sparse demographics.
    core_metrics = ["obesity_rate","overweight_rate","pa_none_rate"]
    nan_before = {m: pivoted[m].isna().sum() for m in core_metrics}
    race_mask = pivoted["StratificationCategory1"] == "Race/Ethnicity"
    for metric in core_metrics:
        # National mean per (race group x year)
        natl_means = (pivoted[race_mask]
                      .groupby(["Stratification1","YearStart"])[metric]
                      .mean())
        # Fill using multi-index lookup
        pivoted.loc[race_mask, metric] = pivoted.loc[race_mask].apply(
            lambda r: natl_means.get((r["Stratification1"], r["YearStart"]))
            if pd.isna(r[metric]) else r[metric], axis=1)
        # Fallback: group mean across all years
        group_means = pivoted[race_mask].groupby("Stratification1")[metric].mean()
        pivoted.loc[race_mask, metric] = pivoted.loc[race_mask].apply(
            lambda r: group_means.get(r["Stratification1"])
            if pd.isna(r[metric]) else r[metric], axis=1)
        remaining = pivoted[metric].isna().sum()
        recovered = nan_before[metric] - remaining
        if recovered:
            print(f"    Level-2 imputation ({metric}): {recovered:,} rows filled via national demographic mean")

    # year_delta: Total obesity change from first to last year, per state.
    # Restrict to the Total stratification first, otherwise "first"/"last" would
    # mix demographic subgroups (e.g. a 2011 male row vs a 2024 income row).
    pivoted = pivoted.sort_values(["LocationDesc","YearStart"])
    tot = pivoted[pivoted["StratificationCategory1"] == "Total"]
    first = tot.groupby("LocationDesc")["obesity_rate"].apply(
        lambda s: s.dropna().iloc[0] if s.notna().any() else np.nan)
    last = tot.groupby("LocationDesc")["obesity_rate"].apply(
        lambda s: s.dropna().iloc[-1] if s.notna().any() else np.nan)
    pivoted["year_delta_obesity"] = pivoted["LocationDesc"].map(last - first)
    print(f"  year_delta: range [{pivoted['year_delta_obesity'].min():+.1f}, {pivoted['year_delta_obesity'].max():+.1f}]pp")

    # stratification_gap: obesity range within income groups per state-year
    inc = pivoted[pivoted["StratificationCategory1"] == "Income"]
    gaps = (inc.groupby(["LocationDesc","YearStart"])["obesity_rate"]
            .agg(lambda x: x.max() - x.min() if x.count() >= 2 else np.nan).reset_index())
    gaps.columns = ["LocationDesc","YearStart","stratification_gap_income"]
    pivoted = pivoted.merge(gaps, on=["LocationDesc","YearStart"], how="left")
    print(f"  gap_income: median={pivoted['stratification_gap_income'].median():.1f}pp")

    # US region
    pivoted["region"] = pivoted["LocationDesc"].map(REGIONS)
    assert pivoted["region"].isna().sum() == 0, "Unmatched state in region map"
    for r, c in pivoted["region"].value_counts().items():
        print(f"    {r}: {c:,} rows")

    # Obesity bins for filtering
    pivoted["obesity_cat"] = pd.cut(pivoted["obesity_rate"], bins=[0,25,30,35,100],
                                    labels=["<25","25-30","30-35",">35"], right=False)

    # income_level: Low / Medium / High
    income_map = {
        "Less than $15,000":  "Low",
        "$15,000 - $24,999":  "Low",
        "$25,000 - $34,999":  "Medium",
        "$35,000 - $49,999":  "Medium",
        "$50,000 - $74,999":  "High",
        "$75,000 or greater": "High",
    }
    pivoted["income_level"] = pivoted["Stratification1"].map(income_map)

    print(f"  Final: {pivoted.shape[0]:,} rows x {pivoted.shape[1]} cols")
    for m in ["obesity_rate","overweight_rate","pa_none_rate"]:
        v = pivoted[m].dropna()
        print(f"    {m}: mean={v.mean():.1f}  median={v.median():.1f}  n={len(v):,}")

    return pivoted


# --- Step 5: Mining ---

def mining():
    from scipy import stats
    from mlxtend.frequent_patterns import apriori, association_rules as apriori_rules

    print("\n--- Mining ---")

    df = pd.read_csv(FEATURES)
    df["YearStart"] = df["YearStart"].astype(int)
    tot = df[df["StratificationCategory1"] == "Total"]

    # Correlations
    metrics = ["obesity_rate","overweight_rate","pa_none_rate","vegetables_less1_rate","fruit_less1_rate"]
    names = ["obesity","overweight","inactivity","low_veg","low_fruit"]

    print("\nCorrelation matrix (Pearson r, 95% CI):")
    for i in range(len(metrics)):
        for j in range(i+1, len(metrics)):
            sub = tot.dropna(subset=[metrics[i], metrics[j]])
            if len(sub) < 10:
                continue
            r, p = stats.pearsonr(sub[metrics[i]], sub[metrics[j]])
            z = np.arctanh(r)
            se = 1/np.sqrt(len(sub)-3)
            zc = stats.norm.ppf(0.975)
            ci = f"[{np.tanh(z-zc*se):.3f}, {np.tanh(z+zc*se):.3f}]"
            sig = "***" if p<0.001 else ("**" if p<0.01 else ("*" if p<0.05 else "ns"))
            print(f"  {names[i]:>12s} vs {names[j]:<12s}  r={r:+.3f}  p={p:.2e}  CI={ci}  {sig}  n={len(sub)}")

    # Stratified: does the activity-obesity link hold across groups?
    print("\nStratified correlations (inactivity vs obesity):")
    for cat in ["Sex","Income","Education","Race/Ethnicity"]:
        sub = df[df["StratificationCategory1"]==cat].dropna(subset=["pa_none_rate","obesity_rate"])
        for grp in sorted(sub["Stratification1"].unique()):
            g = sub[sub["Stratification1"]==grp]
            if len(g) < 10:
                continue
            r, p = stats.pearsonr(g["pa_none_rate"], g["obesity_rate"])
            sig = "*" if p<0.05 else "ns"
            print(f"  {cat:>16s} | {grp:<42s} r={r:+.3f} p={p:.2e} n={len(g)} {sig}")

    # Group means with CIs
    print("\nObesity by income group (with 95% CI):")
    inc_data = df[df["StratificationCategory1"]=="Income"].dropna(subset=["obesity_rate"])
    inc_order = ["Less than $15,000","$15,000 - $24,999","$25,000 - $34,999",
                 "$35,000 - $49,999","$50,000 - $74,999","$75,000 or greater"]
    for level in inc_order:
        g = inc_data[inc_data["Stratification1"]==level]
        if len(g) == 0:
            continue
        m, s, n = g["obesity_rate"].mean(), g["obesity_rate"].std(), len(g)
        tc = stats.t.ppf(0.975, n-1) if n > 1 else 0
        err = tc * s / np.sqrt(n)
        print(f"  {level:<30s} {m:.1f}%  (CI: {m-err:.1f}-{m+err:.1f})  n={n}")

    groups = [g["obesity_rate"].values for _, g in inc_data.groupby("Stratification1")]
    f, p = stats.f_oneway(*groups)
    print(f"  ANOVA: F={f:.0f}, p={p:.2e}")

    print("\nObesity by education (with 95% CI):")
    edu_data = df[df["StratificationCategory1"]=="Education"].dropna(subset=["obesity_rate"])
    for level in sorted(edu_data["Stratification1"].unique()):
        g = edu_data[edu_data["Stratification1"]==level]
        m, s, n = g["obesity_rate"].mean(), g["obesity_rate"].std(), len(g)
        tc = stats.t.ppf(0.975, n-1) if n > 1 else 0
        err = tc * s / np.sqrt(n)
        print(f"  {level:<40s} {m:.1f}%  (CI: {m-err:.1f}-{m+err:.1f})  n={n}")
    groups = [g["obesity_rate"].values for _, g in edu_data.groupby("Stratification1")]
    f, p = stats.f_oneway(*groups)
    print(f"  ANOVA: F={f:.0f}, p={p:.2e}")

    # At-risk groups
    print("\nMost at-risk groups (mean obesity):")
    sub = df[df["StratificationCategory1"]!="Total"].dropna(subset=["obesity_rate"])
    g = sub.groupby(["StratificationCategory1","Stratification1"])["obesity_rate"]
    agg = pd.DataFrame({"mean":g.mean().round(1),"n":g.count()})
    agg = agg[agg["n"]>=20].sort_values("mean",ascending=False)
    for i, ((cat,grp),row) in enumerate(agg.head(10).iterrows()):
        print(f"  {i+1:2d}. {cat}: {grp:<42s} {row['mean']:.1f}%  (n={int(row['n'])})")

    # Association rules
    print("\nAssociation rules (income -> obesity/inactivity):")
    inc = df[df["StratificationCategory1"]=="Income"].dropna(subset=["obesity_rate","pa_none_rate"]).copy()
    inc["low_income"] = inc["Stratification1"].isin(["Less than $15,000","$15,000 - $24,999"])
    inc["high_obesity"] = inc["obesity_rate"] > inc["obesity_rate"].median()
    inc["high_inactive"] = inc["pa_none_rate"] > inc["pa_none_rate"].median()
    items = inc[["low_income","high_obesity","high_inactive"]].dropna()
    freq = apriori(items, min_support=0.05, use_colnames=True, max_len=3)
    if len(freq) >= 2:
        # newer mlxtend wants num_itemsets; older versions don't accept it
        try:
            rules = apriori_rules(freq, metric="confidence", min_threshold=0.5, num_itemsets=len(freq))
        except TypeError:
            rules = apriori_rules(freq, metric="confidence", min_threshold=0.5)
        for _, r in rules.sort_values("lift",ascending=False).head(6).iterrows():
            ant = ", ".join(sorted(r["antecedents"]))
            con = ", ".join(sorted(r["consequents"]))
            print(f"  {{{ant}}} -> {{{con}}}  supp={r['support']:.3f} conf={r['confidence']:.3f} lift={r['lift']:.2f}")


# --- Main ---

if __name__ == "__main__":
    t0 = datetime.now()

    # 1. Load
    raw = load_and_profile()

    # 2. Clean (two versions: static + interpolated)
    clean_static = clean(raw.copy(), interpolate=False)
    validate(clean_static)
    clean_static.to_csv(CLEANED, index=False)
    print(f"\nSaved {CLEANED} ({len(clean_static):,} rows)")

    clean_ts = clean(raw.copy(), interpolate=True)
    validate(clean_ts)
    clean_ts.to_csv(INTERPOLATED, index=False)
    print(f"Saved {INTERPOLATED} ({len(clean_ts):,} rows)")

    # 3. Features
    features_df = engineer()
    # quick NA check
    na = features_df.isna().sum()
    na = na[na > 0]
    if len(na):
        print(f"\n  Missing values in features:")
        for col, cnt in na.items():
            pct = cnt / len(features_df) * 100
            print(f"    {col}: {cnt:,} ({pct:.1f}%) -- from suppressed CDC data")
    features_df.to_csv(FEATURES, index=False)
    bq.write_df(features_df, config.FEATURES_TABLE)
    print(f"\nSaved {FEATURES} ({len(features_df):,} rows)")

    # 4. Mining
    mining()

    print(f"\nDone in {(datetime.now()-t0).total_seconds():.0f}s. Run: streamlit run app.py")
