"""
Central configuration. All BigQuery settings come from environment variables
so nothing sensitive is hardcoded (step 6: config).

Set them in a local .env file (NOT committed) or in your shell:

    GCP_PROJECT=your-gcp-project-id
    BQ_DATASET=brfss
    BQ_LOCATION=US
"""
import os

# Optional: load a local .env file if python-dotenv is installed.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

GCP_PROJECT = os.getenv("GCP_PROJECT", "")
BQ_DATASET = os.getenv("BQ_DATASET", "brfss")
BQ_LOCATION = os.getenv("BQ_LOCATION", "US")

# Table names inside the dataset
RAW_TABLE = "raw_brfss"
FEATURES_TABLE = "brfss_features"


def dataset_ref() -> str:
    if not GCP_PROJECT:
        raise SystemExit(
            "GCP_PROJECT is not set.\n"
            "Run:  export GCP_PROJECT=your-gcp-project-id  (or put it in .env)"
        )
    return f"{GCP_PROJECT}.{BQ_DATASET}"


def table_ref(name: str) -> str:
    return f"{dataset_ref()}.{name}"
