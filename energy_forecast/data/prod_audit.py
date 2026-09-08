from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import pandas as pd

from .audit import DEFAULT_DATABASE_URL, audit_database, expected_hour_index
from .requirements import DataRequirementsService


CORE_VARIABLES = ("omie_price", "demand_forecast", "wind_forecast", "solar_forecast")
FULL_VARIABLES = CORE_VARIABLES + ("hydro_generation", "nuclear_generation")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only PROD data audit for energy_forecast.")
    parser.add_argument("--prod-database-url", default=os.environ.get("PROD_DATABASE_URL"))
    parser.add_argument("--dev-database-url", default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--from", dest="from_date", default="2025-01-01")
    parser.add_argument("--to", dest="to_date", default=pd.Timestamp.now(tz="Europe/Madrid").date().isoformat())
    parser.add_argument("--output-dir", default="reports")
    args = parser.parse_args()

    if not args.prod_database_url:
        print("PROD_DATABASE_URL_REQUIRED: read-only PROD audit needs a production database URL.")
        return 3

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    dev_rows = audit_database(args.dev_database_url, args.from_date, args.to_date)
    prod_rows = audit_database(args.prod_database_url, args.from_date, args.to_date)
    write_csv(output_dir / "prod_data_coverage.csv", prod_rows)

    comparison = compare_dev_prod(dev_rows, prod_rows)
    write_csv(output_dir / "prod_dev_coverage_comparison.csv", comparison)

    plan = build_prod_sync_plan(prod_rows)
    write_csv(output_dir / "prod_data_sync_plan.csv", plan)

    omie = omie_prod_quality(args.prod_database_url, args.from_date, args.to_date)
    write_csv(output_dir / "prod_omie_quality.csv", [omie])

    windows = [
        usable_window("core_d1_dataset", args.prod_database_url, prod_rows, CORE_VARIABLES),
        usable_window("full_fundamentals_dataset", args.prod_database_url, prod_rows, FULL_VARIABLES),
    ]
    write_csv(output_dir / "prod_backtest_windows.csv", windows)

    service = DataRequirementsService(database_url=args.prod_database_url)
    readiness = service.readiness(prod_rows)

    print("OMIE PROD")
    print(f"first_timestamp={omie['first_timestamp']}")
    print(f"last_timestamp={omie['last_timestamp']}")
    print(f"observations={omie['observations']}")
    print(f"coverage_pct={omie['coverage_pct']}")
    print(f"frequency_original={omie['frequency_original']}")
    print(f"conversion_to_hourly={omie['conversion_to_hourly']}")
    print(f"status={omie['status']}")
    print(f"Training readiness PROD: {readiness.training_data_readiness}/100")
    print(f"D+1 readiness PROD: {readiness.d1_forecast_readiness}/100")
    for row in windows:
        print(f"{row['dataset']}: {row['from']} -> {row['to']} coverage={row['coverage_pct']}%")
    print(f"Reports written to {output_dir.resolve()}")
    return 0


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()) if rows else ["status"])
        writer.writeheader()
        writer.writerows(rows)


def compare_dev_prod(dev_rows: list[dict[str, object]], prod_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    dev = {str(row["variable"]): row for row in dev_rows}
    prod = {str(row["variable"]): row for row in prod_rows}
    variables = sorted(set(dev) | set(prod))
    rows = []
    for variable in variables:
        dev_cov = float(dev.get(variable, {}).get("coverage_pct") or 0)
        prod_cov = float(prod.get(variable, {}).get("coverage_pct") or 0)
        diff = round(prod_cov - dev_cov, 4)
        action = "USE_PROD" if diff > 5 else "CHECK_PROD_GAPS" if prod_cov < 95 else "READY"
        if prod.get(variable, {}).get("mapping_status") == "UNKNOWN_MAPPING":
            action = "UNKNOWN_MAPPING"
        rows.append(
            {
                "variable": variable,
                "dev_coverage_pct": dev_cov,
                "prod_coverage_pct": prod_cov,
                "difference": diff,
                "action": action,
            }
        )
    return rows


def build_prod_sync_plan(prod_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    rows = []
    for row in prod_rows:
        priority = str(row.get("priority") or "medium").upper()
        status = str(row.get("availability_status") or "UNKNOWN_MAPPING")
        if status == "COMPLETE":
            action = "READY"
        elif status == "PARTIAL":
            action = "PARTIAL"
        elif status == "MISSING":
            action = "MISSING"
        else:
            action = "UNKNOWN_MAPPING"
        rows.append(
            {
                "variable": row.get("variable"),
                "source": row.get("source"),
                "indicator_id": row.get("indicator_id"),
                "official_name": row.get("indicator_name"),
                "priority": priority,
                "status": action,
                "coverage_pct": row.get("coverage_pct"),
                "missing_intervals": row.get("missing_intervals"),
                "recommended_action": "NO_DOWNLOAD" if action == "READY" else "REVIEW_GAPS_READ_ONLY",
            }
        )
    return rows


def omie_prod_quality(database_url: str, from_date: str, to_date: str) -> dict[str, object]:
    try:
        import psycopg
    except Exception as exc:
        raise RuntimeError("Install psycopg to audit PostgreSQL: python -m pip install psycopg[binary]") from exc

    audit_row = next(row for row in audit_database(database_url, from_date, to_date) if row["variable"] == "omie_price")
    with psycopg.connect(database_url) as connection:
        period_rows = connection.execute(
            """
            select fecha_programa::date as day,
                   count(*) as observations,
                   count(distinct periodo) as periods,
                   min(periodo) as min_period,
                   max(periodo) as max_period
            from omie_prices
            where tipo_precio = 'MD'
              and fecha_programa >= %s::date
              and fecha_programa <= %s::date
            group by fecha_programa::date
            order by fecha_programa::date
            """,
            (from_date, to_date),
        ).fetchall()
    periods = [int(row[2] or 0) for row in period_rows]
    frequency = infer_omie_frequency(periods)
    dst_days = []
    for day, observations, actual_periods, min_period, max_period in period_rows:
        expected_hours = len(expected_hour_index(str(day), str(day)))
        if expected_hours != 24:
            dst_days.append(
                {
                    "day": str(day),
                    "expected_hours": expected_hours,
                    "periods": int(actual_periods or 0),
                    "min_period": int(min_period or 0),
                    "max_period": int(max_period or 0),
                }
            )
    coverage = float(audit_row.get("coverage_pct") or 0)
    return {
        "first_timestamp": audit_row.get("first_timestamp"),
        "last_timestamp": audit_row.get("last_timestamp"),
        "observations": audit_row.get("observations"),
        "coverage_pct": audit_row.get("coverage_pct"),
        "frequency_original": frequency,
        "missing_hours": audit_row.get("missing_hours"),
        "missing_days": audit_row.get("missing_days"),
        "missing_intervals": audit_row.get("missing_intervals"),
        "dst_days": json.dumps(dst_days, ensure_ascii=False),
        "conversion_to_hourly": "SUPPORTED_MEAN_AGGREGATION" if frequency in {"quarter_hourly", "mixed_hourly_quarter_hourly"} else "SUPPORTED_DIRECT_HOURLY",
        "status": "OMIE_PROD_READY" if coverage >= 95 else "PARTIAL",
    }


def infer_omie_frequency(periods: list[int]) -> str:
    if not periods:
        return "missing"
    unique = set(periods)
    if unique.issubset({23, 24, 25}):
        return "hourly"
    if unique.issubset({92, 96, 100}):
        return "quarter_hourly"
    if unique.intersection({23, 24, 25}) and unique.intersection({92, 96, 100}):
        return "mixed_hourly_quarter_hourly"
    return "irregular"


def usable_window(dataset: str, database_url: str, audit_rows: list[dict[str, object]], variables: tuple[str, ...]) -> dict[str, object]:
    required = {variable: row for variable in variables for row in audit_rows if row["variable"] == variable}
    if len(required) != len(variables):
        return {"dataset": dataset, "from": None, "to": None, "hours": 0, "coverage_pct": 0.0, "variables": ",".join(variables)}
    start = max(str(row.get("available_from") or "")[:10] for row in required.values())
    end = min(str(row.get("available_to") or "")[:10] for row in required.values())
    if not start or not end or start > end:
        return {"dataset": dataset, "from": None, "to": None, "hours": 0, "coverage_pct": 0.0, "variables": ",".join(variables)}
    rows = audit_database(database_url, start, end)
    by_variable = {str(row["variable"]): row for row in rows}
    coverage = min(float(by_variable[variable].get("coverage_pct") or 0) for variable in variables)
    return {
        "dataset": dataset,
        "from": start,
        "to": end,
        "hours": by_variable[variables[0]].get("expected_observations"),
        "coverage_pct": round(coverage, 4),
        "variables": ",".join(variables),
    }


if __name__ == "__main__":
    raise SystemExit(main())
