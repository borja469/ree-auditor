from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

import pandas as pd

from .audit import DEFAULT_DATABASE_URL, audit_database, expected_hour_index
from .contracts import MADRID_TZ
from .excel_adapter import ExcelAdapter


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare database and import-file coverage denominators for energy_forecast.")
    parser.add_argument("--from", dest="from_date", required=True)
    parser.add_argument("--to", dest="to_date", required=True)
    parser.add_argument("--input", help="Optional Excel file used by a backtest/import flow.")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--output", default="reports/coverage_diagnosis.csv")
    args = parser.parse_args()

    rows = build_coverage_diagnosis(args.database_url, args.from_date, args.to_date, input_path=args.input)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()) if rows else ["variable"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Coverage diagnosis written to {output.resolve()}")
    for row in rows:
        if row["variable"] in {"omie_price", "demand_forecast", "wind_forecast", "solar_forecast"}:
            print(
                f"{row['variable']:<20} db={row['db_coverage_pct']:>7} input={row['input_coverage_pct']:>7} "
                f"expected_hours={row['expected_hours']}"
            )
    return 0


def build_coverage_diagnosis(
    database_url: str,
    from_date: str,
    to_date: str,
    *,
    input_path: str | None = None,
) -> list[dict[str, object]]:
    expected = expected_hour_index(from_date, to_date)
    audit_rows = audit_database(database_url, from_date, to_date)
    input_coverage = input_variable_coverage(input_path, expected) if input_path else {}
    rows = []
    for row in audit_rows:
        variable = str(row["variable"])
        input_row = input_coverage.get(variable, {})
        rows.append(
            {
                "variable": variable,
                "data_kind": row.get("data_kind"),
                "source": row.get("source"),
                "mapping_status": row.get("mapping_status"),
                "availability_status": row.get("availability_status"),
                "timezone": MADRID_TZ,
                "frequency_expected": "hourly",
                "available_at_filter_applied": False,
                "forecast_observed_filter": row.get("data_kind"),
                "expected_hours": len(expected),
                "db_matched_hours": row.get("expected_observations") and round(float(row.get("coverage_pct") or 0) * int(row.get("expected_observations") or 0) / 100),
                "db_expected_observations": row.get("expected_observations"),
                "db_observations": row.get("observations"),
                "db_first_timestamp": row.get("first_timestamp"),
                "db_last_timestamp": row.get("last_timestamp"),
                "db_coverage_pct": row.get("coverage_pct"),
                "input_matched_hours": input_row.get("matched_hours"),
                "input_total_rows": input_row.get("total_rows"),
                "input_first_timestamp": input_row.get("first_timestamp"),
                "input_last_timestamp": input_row.get("last_timestamp"),
                "input_coverage_pct": input_row.get("coverage_pct"),
                "diagnosis": diagnose(variable, row, input_row, input_path),
            }
        )
    return rows


def input_variable_coverage(path: str, expected: pd.DatetimeIndex) -> dict[str, dict[str, object]]:
    dataset = ExcelAdapter().load_canonical(path)
    rows = dataset.rows.copy()
    if rows.empty:
        return {}
    rows["timestamp"] = pd.to_datetime(rows["timestamp"], utc=True).dt.tz_convert(MADRID_TZ)
    expected_set = set(expected)
    coverage: dict[str, dict[str, object]] = {}
    for variable, group in rows.groupby("variable"):
        hours = set(pd.DatetimeIndex(group["timestamp"]).floor("h"))
        matched = hours.intersection(expected_set)
        coverage[str(variable)] = {
            "matched_hours": len(matched),
            "total_rows": len(group),
            "first_timestamp": min(hours).isoformat() if hours else None,
            "last_timestamp": max(hours).isoformat() if hours else None,
            "coverage_pct": round(len(matched) / len(expected) * 100, 4) if len(expected) else 0.0,
        }
    return coverage


def diagnose(variable: str, db_row: dict[str, object], input_row: dict[str, object], input_path: str | None) -> str:
    if not input_path:
        return "database_audit_only"
    if not input_row:
        return "variable_absent_from_input_file"
    db_cov = float(db_row.get("coverage_pct") or 0)
    input_cov = float(input_row.get("coverage_pct") or 0)
    if variable == "demand_forecast" and db_cov - input_cov > 50:
        return "input_file_is_not_full_esios_history; coverage denominator is the requested horizon while numerator is limited to timestamps present in the supplied file"
    if abs(db_cov - input_cov) > 5:
        return "database_and_input_file_use_different_timestamp_universe_or_missing_filters"
    return "database_and_input_file_coverage_are_consistent"


if __name__ == "__main__":
    raise SystemExit(main())
