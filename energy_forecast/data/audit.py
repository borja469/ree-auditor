from __future__ import annotations

import argparse
import csv
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .aliases import normalize_name
from .config import load_simple_yaml_mapping
from .contracts import MADRID_TZ
from .runtime import load_runtime_config


DEFAULT_DATABASE_URL = ""
REQUIREMENTS_PATH = Path(__file__).resolve().parents[1] / "config" / "data_requirements.yaml"
INDICATORS_PATH = Path(__file__).resolve().parents[1] / "config" / "indicators.yaml"
PROD_AUDIT_VARIABLES = (
    "omie_price",
    "demand_forecast",
    "wind_forecast",
    "solar_forecast",
    "hydro_generation",
    "nuclear_generation",
    "ccgt_generation",
    "france_net_import",
    "portugal_net_import",
)
CORE_TRAINING_VARIABLES = ("omie_price", "demand_forecast", "wind_forecast", "solar_forecast")
FULL_FUNDAMENTALS_VARIABLES = CORE_TRAINING_VARIABLES + ("hydro_generation", "nuclear_generation")


@dataclass(frozen=True)
class CanonicalRule:
    variable: str
    data_kind: str
    required: tuple[str, ...]
    preferred: tuple[str, ...] = ()
    excluded: tuple[str, ...] = ()


RULES = [
    CanonicalRule("demand_forecast", "FORECAST", ("demanda",), ("prevista", "programada", "prevision"), ("real",)),
    CanonicalRule("wind_forecast", "FORECAST", ("eolica",), ("prevision", "prevista", "programada"), ("t.real", "tiempo real")),
    CanonicalRule("solar_forecast", "FORECAST", ("solar",), ("prevision", "prevista", "programada", "pbf"), ("t.real", "tiempo real")),
    CanonicalRule("solar", "OBSERVED", ("solar",), ("fotovoltaica", "termica"), ("prevision", "prevista")),
    CanonicalRule("hydro_expected", "SCHEDULED", ("hidraulica",), ("pbf", "programada"), ("t.real",)),
    CanonicalRule("nuclear_expected", "SCHEDULED", ("nuclear",), ("pbf", "programada"), ("t.real",)),
    CanonicalRule("hydro_generation", "OBSERVED", ("hidraulica",), ("t.real", "tiempo real", "medida"), ("programada",)),
    CanonicalRule("nuclear_generation", "OBSERVED", ("nuclear",), ("t.real", "tiempo real", "medida"), ("programada",)),
    CanonicalRule("france_net_import", "SCHEDULED", ("francia",), ("importacion", "exportacion", "intercambio", "pbf"), ("capacidad", "ntc")),
    CanonicalRule("portugal_net_import", "SCHEDULED", ("portugal",), ("importacion", "exportacion", "intercambio", "pbf"), ("capacidad", "ntc")),
    CanonicalRule("net_import_expected", "SCHEDULED", ("intercambio",), ("saldo", "internacional", "pbf"), ("capacidad", "ntc", "demanda", "renta", "congestion", "balance", "precio")),
    CanonicalRule("ccgt_generation", "OBSERVED", ("ciclo combinado",), ("t.real", "tiempo real", "generacion"), ("programada",)),
    CanonicalRule("ccgt_expected", "SCHEDULED", ("ciclo combinado",), ("pbf", "programada"), ("t.real",)),
    CanonicalRule("unavailability_generation", "SCHEDULED", ("indisponibilidad",), ("generacion", "programada"), ()),
]


def main() -> int:
    runtime = load_runtime_config()
    parser = argparse.ArgumentParser(description="Audit ESIOS/OMIE historical availability for energy_forecast.")
    parser.add_argument("--database-url", default=runtime.database_url or DEFAULT_DATABASE_URL)
    parser.add_argument("--from", dest="from_date", default="2025-01-01")
    parser.add_argument("--to", dest="to_date", default=None)
    parser.add_argument("--output", default=None)
    parser.add_argument("--sync-plan-output", default=None)
    args = parser.parse_args()

    if not args.database_url:
        print("DATABASE_URL_REQUIRED: audit needs DATABASE_URL, PROD_DATABASE_URL, or --database-url.")
        return 3

    output_path = args.output or ("reports/prod_data_coverage.csv" if runtime.environment == "prod" else "reports/data_coverage.csv")
    sync_plan_path = args.sync_plan_output or ("reports/prod_data_sync_plan.csv" if runtime.environment == "prod" else None)
    rows = audit_database(args.database_url, args.from_date, args.to_date)
    output_rows = prod_coverage_rows(rows) if runtime.environment == "prod" else rows
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(output_rows[0].keys()) if output_rows else ["variable"])
        writer.writeheader()
        writer.writerows(output_rows)
    if sync_plan_path:
        sync_plan = build_read_only_sync_plan(rows)
        sync_output = Path(sync_plan_path)
        sync_output.parent.mkdir(parents=True, exist_ok=True)
        with sync_output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(sync_plan[0].keys()) if sync_plan else ["variable"])
            writer.writeheader()
            writer.writerows(sync_plan)
    if runtime.environment == "prod":
        print("ENERGY_FORECAST_ENV=prod")
        print(f"ENERGY_FORECAST_READ_ONLY={str(runtime.read_only).lower()}")
        for row in output_rows:
            print(f"{row['variable']:<24} {row['coverage']:>7.4f}% {row['status']}")
        readiness = calculate_readiness(rows)
        core = largest_continuous_period(rows, CORE_TRAINING_VARIABLES)
        full = largest_continuous_period(rows, FULL_FUNDAMENTALS_VARIABLES)
        omie = omie_quality(args.database_url, args.from_date, args.to_date or pd.Timestamp.now(tz=MADRID_TZ).date().isoformat())
        print(f"Training Data Readiness: {readiness['training_data_readiness']}/100")
        print(f"D+1 Forecast Readiness: {readiness['d1_forecast_readiness']}/100")
        print(f"core_training_period: {core['from']} -> {core['to']} hours={core['hours']}")
        print(f"full_fundamentals_period: {full['from']} -> {full['to']} hours={full['hours']}")
        print(
            "OMIE PROD: "
            f"coverage={omie['coverage']}% periods_status={omie['periods_status']} "
            f"timezone={omie['timezone']} duplicates={omie['duplicate_period_rows']} "
            f"conversion={omie['conversion_to_hourly']}"
        )
        if sync_plan_path:
            print(f"Read-only sync plan written to {Path(sync_plan_path).resolve()}")
        if runtime.read_only:
            print("Read-only audit complete: no downloads, inserts, updates, deletes, sync, or forecast persistence executed.")
    else:
        for row in rows:
            if row["mapping_status"] != "UNKNOWN_MAPPING":
                print(f"{row['variable']:<28} {row['coverage_pct']:>6.2f}% {row['availability_status']}")
    print(f"Coverage report written to {output.resolve()}")
    return 0


def audit_database(database_url: str, from_date: str, to_date: str | None = None) -> list[dict[str, object]]:
    try:
        import psycopg
    except Exception as exc:
        raise RuntimeError("Install psycopg to audit PostgreSQL: python -m pip install psycopg[binary]") from exc

    end = to_date or pd.Timestamp.now(tz=MADRID_TZ).date().isoformat()
    expected_index = expected_hour_index(from_date, end)
    expected = len(expected_index)
    requirements = load_data_requirements()
    with psycopg.connect(database_url) as connection:
        indicator_rows = connection.execute(
            """
            select i.indicator_id, i.name, i.short_name, i.description, i.unit, i.frequency,
                   count(v.*) as observations,
                   min(v.datetime) as first_timestamp,
                   max(v.datetime) as last_timestamp,
                   count(distinct date_trunc('hour', v.datetime)) as distinct_hours
            from esios_indicators i
            left join esios_indicator_values v
              on v.indicator_id = i.indicator_id
             and v.datetime >= %s::timestamp
             and v.datetime < (%s::date + interval '1 day')
            group by i.indicator_id, i.name, i.short_name, i.description, i.unit, i.frequency
            order by i.indicator_id
            """,
            (from_date, end),
        ).fetchall()
        esios_hours = connection.execute(
            """
            select indicator_id, date_trunc('hour', datetime) as timestamp
            from esios_indicator_values
            where datetime >= %s::timestamp
              and datetime < (%s::date + interval '1 day')
              and value is not null
            group by indicator_id, date_trunc('hour', datetime)
            order by indicator_id, timestamp
            """,
            (from_date, end),
        ).fetchall()
        omie = connection.execute(
            """
            select count(*) as observations, min(fecha_programa), max(fecha_programa),
                   count(distinct fecha_programa::timestamp + (floor((periodo - 1) / 4.0) * interval '1 hour')) as distinct_hours
            from omie_prices
            where tipo_precio = 'MD'
              and fecha_programa >= %s::date
              and fecha_programa <= %s::date
            """,
            (from_date, end),
        ).fetchone()
        omie_hours = connection.execute(
            """
            select fecha_programa::timestamp + (floor((periodo - 1) / 4.0) * interval '1 hour') as timestamp
            from omie_prices
            where tipo_precio = 'MD'
              and fecha_programa >= %s::date
              and fecha_programa <= %s::date
            group by 1
            order by 1
            """,
            (from_date, end),
        ).fetchall()
    candidates = [indicator_to_dict(row) for row in indicator_rows]
    hours_by_indicator: dict[int, set[pd.Timestamp]] = {}
    for indicator_id, timestamp in esios_hours:
        hours_by_indicator.setdefault(int(indicator_id), set()).add(localize_hour(timestamp))
    omie_hour_set = {localize_hour(row[0]) for row in omie_hours}
    report = [omie_row(omie, expected_index, omie_hour_set, requirements.get("omie_price", {}))]
    used_ids: set[int] = set()
    for rule in RULES:
        requirement = requirements.get(rule.variable, {})
        configured_id = requirement.get("indicator_id")
        if configured_id:
            match = next((candidate for candidate in candidates if candidate["indicator_id"] == int(configured_id)), None)
        else:
            match = best_match(rule, candidates)
        if match is None:
            report.append(empty_row(rule.variable, expected_index, "MISSING", "UNKNOWN_MAPPING", rule.data_kind, requirement))
            continue
        used_ids.add(int(match["indicator_id"]))
        report.append(coverage_row(rule.variable, match, expected_index, hours_by_indicator.get(int(match["indicator_id"]), set()), rule.data_kind, "MAPPED", requirement))
    for candidate in candidates:
        if candidate["indicator_id"] not in used_ids and candidate["observations"] > 0:
            report.append(coverage_row(f"unknown_esios_{candidate['indicator_id']}", candidate, expected_index, hours_by_indicator.get(int(candidate["indicator_id"]), set()), "UNKNOWN", "UNKNOWN_MAPPING", {}))
    return report


def indicator_to_dict(row) -> dict[str, object]:
    indicator_id, name, short_name, description, unit, frequency, observations, first_timestamp, last_timestamp, distinct_hours = row
    text = " ".join(str(value or "") for value in [name, short_name, description, unit, frequency])
    return {
        "indicator_id": int(indicator_id),
        "name": name,
        "text": normalize_text(text),
        "unit": unit,
        "frequency": frequency,
        "observations": int(observations or 0),
        "first_timestamp": first_timestamp,
        "last_timestamp": last_timestamp,
        "distinct_hours": int(distinct_hours or 0),
    }


def best_match(rule: CanonicalRule, candidates: list[dict[str, object]]) -> dict[str, object] | None:
    scored = []
    for candidate in candidates:
        text = str(candidate["text"])
        if any(term in text for term in map(normalize_text, rule.excluded)):
            continue
        if not all(term in text for term in map(normalize_text, rule.required)):
            continue
        score = int(candidate["distinct_hours"]) + 5000 * sum(term in text for term in map(normalize_text, rule.preferred))
        scored.append((score, candidate))
    if not scored:
        return None
    return sorted(scored, key=lambda item: item[0], reverse=True)[0][1]


def coverage_row(
    variable: str,
    candidate: dict[str, object],
    expected_index: pd.DatetimeIndex,
    available_hours: set[pd.Timestamp],
    data_kind: str,
    mapping_status: str,
    requirement: dict[str, object],
) -> dict[str, object]:
    expected = len(expected_index)
    matched = set(expected_index).intersection(available_hours)
    gaps = summarize_missing(expected_index, matched)
    observed_count = int(len(matched) if data_kind == "OBSERVED" else 0)
    forecast_count = int(len(matched) if data_kind in {"FORECAST", "SCHEDULED", "PROXY"} else 0)
    coverage = 0.0 if expected == 0 else round(len(matched) / expected * 100, 4)
    source = str(requirement.get("source") or ("omie" if variable == "omie_price" else "esios"))
    source_status = "OMIE_SERVICE_AVAILABLE" if variable == "omie_price" and source == "omie" else ""
    return {
        "variable": variable,
        "indicator_id": candidate["indicator_id"],
        "indicator_name": candidate["name"],
        "required": bool(requirement.get("required", False)),
        "priority": requirement.get("priority", "medium"),
        "source": source,
        "source_status": source_status,
        "required_from": expected_index.min().date().isoformat() if expected else None,
        "required_to": expected_index.max().date().isoformat() if expected else None,
        "data_kind": data_kind,
        "mapping_status": mapping_status,
        "availability_status": availability_status(coverage, mapping_status, float(requirement.get("min_coverage") or 0.98) * 100),
        "available_from": min(matched).isoformat() if matched else None,
        "available_to": max(matched).isoformat() if matched else None,
        "first_timestamp": min(matched).isoformat() if matched else None,
        "last_timestamp": max(matched).isoformat() if matched else None,
        "observations": candidate["observations"],
        "expected_observations": expected,
        "coverage_pct": coverage,
        "observed_count": observed_count,
        "forecast_count": forecast_count,
        "missing_pct": round(100 - coverage, 4),
        "missing_intervals": json.dumps(gaps["missing_intervals"]),
        "missing_days": gaps["missing_days"],
        "missing_hours": gaps["missing_hours"],
    }


def omie_row(row, expected_index: pd.DatetimeIndex, available_hours: set[pd.Timestamp], requirement: dict[str, object]) -> dict[str, object]:
    observations, first_timestamp, last_timestamp, distinct_hours = row
    candidate = {
        "indicator_id": None,
        "name": "Precio OMIE MD",
        "first_timestamp": first_timestamp,
        "last_timestamp": last_timestamp,
        "observations": int(observations or 0),
        "distinct_hours": int(distinct_hours or 0),
    }
    return coverage_row("omie_price", candidate, expected_index, available_hours, "OBSERVED", "MAPPED", requirement)


def empty_row(variable: str, expected_index: pd.DatetimeIndex, availability: str, mapping: str, data_kind: str, requirement: dict[str, object]) -> dict[str, object]:
    expected = len(expected_index)
    gaps = summarize_missing(expected_index, set())
    return {
        "variable": variable,
        "indicator_id": None,
        "indicator_name": None,
        "required": bool(requirement.get("required", False)),
        "priority": requirement.get("priority", "medium"),
        "source": requirement.get("source", "esios"),
        "source_status": "",
        "required_from": expected_index.min().date().isoformat() if expected else None,
        "required_to": expected_index.max().date().isoformat() if expected else None,
        "data_kind": data_kind,
        "mapping_status": mapping,
        "availability_status": availability,
        "available_from": None,
        "available_to": None,
        "first_timestamp": None,
        "last_timestamp": None,
        "observations": 0,
        "expected_observations": expected,
        "coverage_pct": 0.0,
        "observed_count": 0,
        "forecast_count": 0,
        "missing_pct": 100.0,
        "missing_intervals": json.dumps(gaps["missing_intervals"]),
        "missing_days": gaps["missing_days"],
        "missing_hours": gaps["missing_hours"],
    }


def availability_status(coverage: float, mapping_status: str, min_coverage_pct: float = 98) -> str:
    if mapping_status == "UNKNOWN_MAPPING":
        return "UNKNOWN_MAPPING"
    if coverage >= min_coverage_pct:
        return "COMPLETE"
    if coverage > 0:
        return "PARTIAL"
    return "MISSING"


def expected_hour_index(start: str, end: str) -> pd.DatetimeIndex:
    return pd.date_range(
        pd.Timestamp(start).tz_localize(MADRID_TZ),
        (pd.Timestamp(end) + pd.Timedelta(days=1)).tz_localize(MADRID_TZ),
        freq="h",
        inclusive="left",
    )


def summarize_missing(expected_index: pd.DatetimeIndex, matched: set[pd.Timestamp]) -> dict[str, object]:
    missing = [timestamp for timestamp in expected_index if timestamp not in matched]
    intervals = []
    if missing:
        start = previous = missing[0]
        for timestamp in missing[1:]:
            if timestamp - previous == pd.Timedelta(hours=1):
                previous = timestamp
                continue
            intervals.append({"from": start.isoformat(), "to": previous.isoformat(), "hours": int((previous - start) / pd.Timedelta(hours=1)) + 1})
            start = previous = timestamp
        intervals.append({"from": start.isoformat(), "to": previous.isoformat(), "hours": int((previous - start) / pd.Timedelta(hours=1)) + 1})
    return {
        "missing_intervals": intervals,
        "missing_days": len({timestamp.date().isoformat() for timestamp in missing}),
        "missing_hours": len(missing),
    }


def load_data_requirements() -> dict[str, dict[str, object]]:
    requirements = load_simple_yaml_mapping(REQUIREMENTS_PATH) if REQUIREMENTS_PATH.exists() else {}
    indicators = load_simple_yaml_mapping(INDICATORS_PATH) if INDICATORS_PATH.exists() else {}
    for variable, payload in requirements.items():
        if not payload.get("indicator_id") and variable in indicators and indicators[variable].get("id"):
            payload["indicator_id"] = indicators[variable]["id"]
    return requirements


def normalize_text(value: str) -> str:
    return re.sub(r"_", " ", normalize_name(value))


def localize_hour(value) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is not None:
        return timestamp.tz_convert(MADRID_TZ)
    return timestamp.tz_localize(MADRID_TZ, ambiguous=True, nonexistent="shift_forward")


def prod_coverage_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    by_variable = {str(row["variable"]): row for row in rows}
    output = []
    for variable in PROD_AUDIT_VARIABLES:
        row = by_variable.get(variable)
        if not row:
            output.append(
                {
                    "variable": variable,
                    "indicator_id": None,
                    "coverage": 0.0,
                    "first_timestamp": None,
                    "last_timestamp": None,
                    "missing_ranges": "[]",
                    "status": "MISSING",
                }
            )
            continue
        output.append(
            {
                "variable": variable,
                "indicator_id": row.get("indicator_id"),
                "coverage": row.get("coverage_pct"),
                "first_timestamp": row.get("first_timestamp"),
                "last_timestamp": row.get("last_timestamp"),
                "missing_ranges": row.get("missing_intervals"),
                "status": row.get("availability_status"),
            }
        )
    return output


def build_read_only_sync_plan(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    plan = []
    for row in rows:
        variable = str(row.get("variable"))
        if variable.startswith("unknown_esios_"):
            continue
        intervals = json.loads(str(row.get("missing_intervals") or "[]"))
        if row.get("mapping_status") == "UNKNOWN_MAPPING":
            plan.append(sync_plan_row(row, None, None, "CHECK_MAPPING"))
            continue
        if row.get("availability_status") == "COMPLETE":
            plan.append(sync_plan_row(row, None, None, "NO_ACTION"))
            continue
        if intervals:
            for interval in intervals:
                plan.append(sync_plan_row(row, interval["from"][:10], interval["to"][:10], "DOWNLOAD_GAPS"))
            continue
        plan.append(sync_plan_row(row, row.get("required_from"), row.get("required_to"), "SOURCE_MISSING"))
    return plan


def sync_plan_row(row: dict[str, object], missing_from: object, missing_to: object, action: str) -> dict[str, object]:
    return {
        "variable": row.get("variable"),
        "indicator_id": row.get("indicator_id"),
        "coverage": row.get("coverage_pct"),
        "missing_from": missing_from,
        "missing_to": missing_to,
        "priority": row.get("priority"),
        "action": action,
    }


def calculate_readiness(rows: list[dict[str, object]]) -> dict[str, float]:
    requirements = load_data_requirements()
    required = [row for row in rows if requirements.get(str(row["variable"]), {}).get("required", False)]
    forecast_inputs = [row for row in required if row["variable"] != "omie_price"]
    return {
        "training_data_readiness": round(weighted_readiness(required), 2),
        "d1_forecast_readiness": round(weighted_readiness(forecast_inputs), 2),
    }


def weighted_readiness(rows: list[dict[str, object]]) -> float:
    if not rows:
        return 0.0
    weights = {"critical": 4.0, "high": 2.0, "medium": 1.0, "low": 0.5}
    total_weight = 0.0
    score = 0.0
    for row in rows:
        weight = weights.get(str(row.get("priority", "medium")), 1.0)
        total_weight += weight
        score += min(float(row.get("coverage_pct") or 0), 100.0) * weight
    return 0.0 if total_weight == 0 else score / total_weight


def largest_continuous_period(rows: list[dict[str, object]], variables: tuple[str, ...]) -> dict[str, object]:
    by_variable = {str(row["variable"]): row for row in rows}
    selected = [by_variable.get(variable) for variable in variables]
    if any(row is None for row in selected):
        return {"from": None, "to": None, "hours": 0, "variables": ",".join(variables)}
    start = max(str(row.get("required_from")) for row in selected if row)
    end = min(str(row.get("required_to")) for row in selected if row)
    if not start or not end or start > end:
        return {"from": None, "to": None, "hours": 0, "variables": ",".join(variables)}
    expected = expected_hour_index(start, end)
    available = set(expected)
    for row in selected:
        missing = expand_missing_ranges(json.loads(str(row.get("missing_intervals") or "[]")))
        available -= missing
    best_start = best_end = current_start = current_end = None
    for timestamp in expected:
        if timestamp in available:
            if current_start is None:
                current_start = timestamp
            current_end = timestamp
            continue
        if current_start is not None and is_better_window(current_start, current_end, best_start, best_end):
            best_start, best_end = current_start, current_end
        current_start = current_end = None
    if current_start is not None and is_better_window(current_start, current_end, best_start, best_end):
        best_start, best_end = current_start, current_end
    if best_start is None or best_end is None:
        return {"from": None, "to": None, "hours": 0, "variables": ",".join(variables)}
    return {
        "from": best_start.isoformat(),
        "to": best_end.isoformat(),
        "hours": int((best_end - best_start) / pd.Timedelta(hours=1)) + 1,
        "variables": ",".join(variables),
    }


def expand_missing_ranges(intervals: list[dict[str, object]]) -> set[pd.Timestamp]:
    missing: set[pd.Timestamp] = set()
    for interval in intervals:
        start = pd.Timestamp(str(interval["from"]))
        end = pd.Timestamp(str(interval["to"]))
        if start.tzinfo is None:
            start = start.tz_localize(MADRID_TZ, ambiguous=True, nonexistent="shift_forward")
        else:
            start = start.tz_convert(MADRID_TZ)
        if end.tzinfo is None:
            end = end.tz_localize(MADRID_TZ, ambiguous=True, nonexistent="shift_forward")
        else:
            end = end.tz_convert(MADRID_TZ)
        missing.update(pd.date_range(start, end, freq="h"))
    return missing


def is_better_window(start: pd.Timestamp, end: pd.Timestamp | None, best_start: pd.Timestamp | None, best_end: pd.Timestamp | None) -> bool:
    if end is None:
        return False
    if best_start is None or best_end is None:
        return True
    return end - start > best_end - best_start


def omie_quality(database_url: str, from_date: str, to_date: str) -> dict[str, object]:
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
                   count(distinct periodo) as distinct_periods,
                   count(*) - count(distinct periodo) as duplicate_period_rows,
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
    period_counts = [int(row[2] or 0) for row in period_rows]
    duplicate_rows = sum(int(row[3] or 0) for row in period_rows)
    valid_period_counts = {92, 96, 100}
    invalid_days = [
        str(day)
        for day, _observations, distinct_periods, _duplicates, _min_period, _max_period in period_rows
        if int(distinct_periods or 0) not in valid_period_counts
    ]
    frequency = infer_omie_frequency(period_counts)
    return {
        "coverage": audit_row.get("coverage_pct"),
        "first_timestamp": audit_row.get("first_timestamp"),
        "last_timestamp": audit_row.get("last_timestamp"),
        "timezone": MADRID_TZ,
        "source_frequency": frequency,
        "periods_status": "OK_92_96_100" if not invalid_days else "INVALID_PERIOD_COUNTS",
        "invalid_period_days": json.dumps(invalid_days, ensure_ascii=False),
        "duplicate_period_rows": duplicate_rows,
        "conversion_to_hourly": "Europe/Madrid hourly mean from 92/96/100 OMIE periods",
    }


def infer_omie_frequency(periods: list[int]) -> str:
    if not periods:
        return "missing"
    unique = set(periods)
    if unique.issubset({92, 96, 100}):
        return "quarter_hourly"
    if unique.issubset({23, 24, 25}):
        return "hourly"
    if unique.intersection({92, 96, 100}) and unique.intersection({23, 24, 25}):
        return "mixed_hourly_quarter_hourly"
    return "irregular"


if __name__ == "__main__":
    raise SystemExit(main())
