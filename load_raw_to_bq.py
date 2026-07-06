"""
One-time script: upload the raw CDC CSV into BigQuery.

Usage:
    python load_raw_to_bq.py data/Nutrition_Physical_Activity_Obesity.csv
"""
import sys

import bq
import config


def main() -> None:
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "data/Nutrition_Physical_Activity_Obesity.csv"
    bq.load_csv_to_table(csv_path, config.RAW_TABLE)


if __name__ == "__main__":
    main()
