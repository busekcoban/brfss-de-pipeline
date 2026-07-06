"""
BigQuery I/O helpers (step 1: data store).

Auth: uses Application Default Credentials.
  - Local dev:  gcloud auth application-default login
  - Docker/CI:  set GOOGLE_APPLICATION_CREDENTIALS to a service-account key path
"""
from __future__ import annotations

import csv
import re

import pandas as pd
from google.cloud import bigquery

import config


def get_client() -> bigquery.Client:
    return bigquery.Client(
        project=config.GCP_PROJECT or None,
        location=config.BQ_LOCATION,
    )


def ensure_dataset(client: bigquery.Client) -> None:
    """Create the dataset if it does not exist yet."""
    ds_id = config.dataset_ref()
    try:
        client.get_dataset(ds_id)
    except Exception:
        ds = bigquery.Dataset(ds_id)
        ds.location = config.BQ_LOCATION
        client.create_dataset(ds, exists_ok=True)
        print(f"Created dataset {ds_id}")


def _safe_column(name: str) -> str:
    """Make a CSV header safe for BigQuery (e.g. 'Age(years)' -> 'Age_years_')."""
    return re.sub(r"[^A-Za-z0-9_]", "_", name)


def load_csv_to_table(csv_path: str, table: str) -> None:
    """One-time raw load: CSV file -> BigQuery table (overwrites).

    Every column is loaded as STRING so source quirks are preserved verbatim —
    most importantly the European comma decimals ("34,8"). If we let BigQuery
    autodetect types, it parses "34,8" as 348, corrupting the data. Typing and
    parsing happen later in the pipeline (raw layer stays faithful to source).
    """
    client = get_client()
    ensure_dataset(client)
    table_id = config.table_ref(table)

    with open(csv_path, newline="", encoding="utf-8") as f:
        header = next(csv.reader(f))
    schema = [bigquery.SchemaField(_safe_column(col), "STRING") for col in header]

    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.CSV,
        skip_leading_rows=1,
        schema=schema,
        write_disposition="WRITE_TRUNCATE",
        allow_quoted_newlines=True,
    )
    with open(csv_path, "rb") as f:
        job = client.load_table_from_file(f, table_id, job_config=job_config)
    job.result()
    n = client.get_table(table_id).num_rows
    print(f"Loaded {n:,} rows into {table_id}")


def read_table(table: str) -> pd.DataFrame:
    """Read a whole table into a DataFrame.

    create_bqstorage_client=False avoids the gRPC Storage API, which can hang
    on restricted networks; the REST path is slower but reliable.
    """
    client = get_client()
    return client.list_rows(config.table_ref(table)).to_dataframe(
        create_bqstorage_client=False
    )


def write_df(df: pd.DataFrame, table: str) -> None:
    """Write a DataFrame to BigQuery (overwrites)."""
    client = get_client()
    ensure_dataset(client)
    table_id = config.table_ref(table)
    job_config = bigquery.LoadJobConfig(write_disposition="WRITE_TRUNCATE")
    job = client.load_table_from_dataframe(df, table_id, job_config=job_config)
    job.result()
    print(f"Wrote {len(df):,} rows to {table_id}")