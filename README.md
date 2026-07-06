# US Obesity & Health Trends — Data Pipeline (2011–2024)

[![CI](https://github.com/busekcoban/brfss-de-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/busekcoban/brfss-de-pipeline/actions/workflows/ci.yml)

**🔗 Live demo:** https://brfss-dashboard.streamlit.app/

An end-to-end data pipeline that ingests CDC BRFSS public-health data into
**Google BigQuery**, cleans and validates it, engineers analytical features,
runs statistical mining, and serves the results through an interactive
**Streamlit** dashboard. The project includes automated data-quality tests,
Docker packaging, and a CI workflow.

Dataset: CDC BRFSS — *Nutrition, Physical Activity, and Obesity* 

---

## Architecture

```
CDC CSV ──► BigQuery (raw_brfss)  ──►  pipeline.py ──►  BigQuery (brfss_features)  ──►  Streamlit dashboard
          (raw layer, all STRING)   clean → validate → features → mining
```

The pipeline follows an **ELT** pattern. The raw layer keeps the source data
exactly as delivered (including its European comma decimals, e.g. `34,8`), and
all typing and transformation happen downstream. This keeps the raw table
faithful to the source and makes every transformation reproducible.

| Layer | Files | Description |
|-------|-------|-------------|
| Ingestion | `load_raw_to_bq.py`, `bq.py` | Loads the raw CSV into BigQuery as text. |
| Transformation | `pipeline.py` | Cleans, validates, engineers features, and mines statistics. |
| Data quality | `validation.py`, `tests/` | Reusable checks, run in the pipeline and in CI. |
| Serving | `app.py`, `dashboard.html` | Streamlit app embedding an interactive dashboard. |
| Config | `config.py`, `.env` | Environment-based settings (no secrets in code). |

---

## Pipeline steps

1. **Ingest** — the raw CSV is loaded into BigQuery with every column typed as
   `STRING`, so source formatting is preserved.
2. **Clean** — drop empty columns, remove non-state rows, convert comma decimals
   to numbers, handle CDC-suppressed values, and interpolate time-series gaps.
3. **Validate** — data-quality gate: year completeness, no duplicates, value
   ranges, expected location count, and valid category set.
4. **Feature engineering** — pivot metrics to columns, add income levels, yearly
   obesity change, income-gap and US-region features.
5. **Mining** — Pearson correlations with confidence intervals, ANOVA across
   income and education groups, and Apriori association rules.
6. **Load** — the final feature table is written back to BigQuery.

---

## Getting started

### Prerequisites
- Python 3.12+
- A Google Cloud project with the BigQuery API enabled
- `gcloud` CLI installed

### 1. Configure
Create a `.env` file in the project root:
```
GCP_PROJECT=your-gcp-project-id
BQ_DATASET=brfss
BQ_LOCATION=US
```

### 2. Authenticate
```bash
gcloud auth application-default login
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Load data and run the pipeline
```bash
python load_raw_to_bq.py data/Nutrition_Physical_Activity_Obesity.csv
python pipeline.py
```

### 5. Launch the dashboard
```bash
streamlit run app.py
```

---

## Tests

Data-quality checks are unit-tested and require no cloud access:
```bash
pip install -r requirements-dev.txt
pytest -q
```

---

## Docker

The whole project is containerized, so it runs the same way on any machine
with Docker — no local Python setup required.

Build the image:
```bash
docker build -t brfss-dashboard .
```

Run the dashboard (serves static content, no credentials needed):
```bash
docker compose up dashboard
```

Run the full ETL pipeline in a container (reads from and writes to BigQuery):
```bash
docker compose run --rm pipeline
```
The pipeline container authenticates to BigQuery with a service-account key
mounted read-only at `secrets/sa.json` (configured in `docker-compose.yml`).
The key is git-ignored and never committed.

---

## Continuous Integration

`.github/workflows/ci.yml` runs on every push and pull request:
- installs test dependencies and runs `pytest`
- builds the Docker image once tests pass

---

## Project structure

```
.
├── config.py              # environment-based settings
├── bq.py                  # BigQuery load / read / write helpers
├── load_raw_to_bq.py      # one-time raw CSV -> BigQuery
├── pipeline.py            # clean -> validate -> features -> mining -> load
├── validation.py          # reusable data-quality checks
├── app.py, dashboard.html # Streamlit dashboard
├── tests/                 # pytest data-quality tests
├── Dockerfile, docker-compose.yml
├── .github/workflows/ci.yml
├── requirements.txt, requirements-dev.txt
└── data/                  # feature table (raw CSV excluded — see note)
```

> The raw file (`data/Nutrition_Physical_Activity_Obesity.csv`, ~48 MB) is not
> committed. Download it from the CDC and place it under `data/`:
> https://data.cdc.gov/Nutrition-Physical-Activity-and-Obesity/Nutrition-Physical-Activity-and-Obesity-Behavioral/hn4x-zwk7

---

## Tech stack

Python · pandas · Google BigQuery · Streamlit · Plotly · SciPy · mlxtend ·
pytest · Docker · GitHub Actions
