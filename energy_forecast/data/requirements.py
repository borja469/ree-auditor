from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .audit import DEFAULT_DATABASE_URL, audit_database, load_data_requirements


PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@dataclass
class DataReadiness:
    training_data_readiness: float
    d1_forecast_readiness: float
    blocking: list[dict[str, object]]


class DataRequirementsService:
    def __init__(self, *, database_url: str | None = None, requirements_path: str | Path | None = None):
        self.database_url = database_url or os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
        self.requirements = load_data_requirements()

    def audit(self, from_date: str, to_date: str) -> list[dict[str, object]]:
        return audit_database(self.database_url, from_date, to_date)

    def get_missing_requirements(self, from_date: str, to_date: str) -> list[dict[str, object]]:
        rows = self.audit(from_date, to_date)
        missing: list[dict[str, object]] = []
        for row in rows:
            requirement = self.requirements.get(str(row["variable"]))
            if not requirement or not requirement.get("required", False):
                continue
            if row["availability_status"] == "COMPLETE":
                continue
            if row["mapping_status"] == "UNKNOWN_MAPPING":
                missing.append(base_missing(row, None, None))
                continue
            intervals = json.loads(str(row.get("missing_intervals") or "[]"))
            if not intervals:
                continue
            for interval in intervals:
                missing.append(base_missing(row, interval["from"][:10], interval["to"][:10]))
        return sorted(coalesce_missing_ranges(missing), key=lambda item: (PRIORITY_ORDER.get(str(item["priority"]), 99), item["variable"], item.get("missing_from") or ""))

    def readiness(self, rows: list[dict[str, object]]) -> DataReadiness:
        required = [row for row in rows if self.requirements.get(str(row["variable"]), {}).get("required", False)]
        forecast_inputs = [row for row in required if row["variable"] != "omie_price"]
        training = weighted_readiness(required)
        d1 = weighted_readiness(forecast_inputs)
        blocking = []
        for row in required:
            minimum = float(self.requirements[str(row["variable"])].get("min_coverage") or 0.95) * 100
            if float(row["coverage_pct"]) < minimum or row["mapping_status"] == "UNKNOWN_MAPPING":
                blocking.append(
                    {
                        "variable": row["variable"],
                        "coverage_pct": row["coverage_pct"],
                        "required_coverage_pct": minimum,
                        "status": row["availability_status"],
                    }
                )
        return DataReadiness(round(training, 2), round(d1, 2), blocking)


def get_missing_requirements(from_date: str, to_date: str, *, database_url: str | None = None) -> list[dict[str, object]]:
    return DataRequirementsService(database_url=database_url).get_missing_requirements(from_date, to_date)


def base_missing(row: dict[str, object], missing_from: str | None, missing_to: str | None) -> dict[str, object]:
    return {
        "variable": row["variable"],
        "indicator_id": row["indicator_id"],
        "source": row["source"],
        "missing_from": missing_from,
        "missing_to": missing_to,
        "priority": row["priority"],
        "coverage_pct": row["coverage_pct"],
        "status": row["availability_status"],
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


def coalesce_missing_ranges(items: list[dict[str, object]]) -> list[dict[str, object]]:
    import pandas as pd

    grouped: dict[tuple[object, object, object, object], set[pd.Timestamp]] = {}
    passthrough = []
    for item in items:
        if not item.get("missing_from") or not item.get("missing_to"):
            passthrough.append(item)
            continue
        key = (item["variable"], item["indicator_id"], item["source"], item["priority"])
        days = pd.date_range(str(item["missing_from"]), str(item["missing_to"]), freq="D")
        grouped.setdefault(key, set()).update(days)
    result = passthrough[:]
    for (variable, indicator_id, source, priority), days in grouped.items():
        ordered = sorted(days)
        if not ordered:
            continue
        start = previous = ordered[0]
        for day in ordered[1:]:
            if day - previous == pd.Timedelta(days=1):
                previous = day
                continue
            result.append(build_coalesced_item(variable, indicator_id, source, priority, start, previous))
            start = previous = day
        result.append(build_coalesced_item(variable, indicator_id, source, priority, start, previous))
    return result


def build_coalesced_item(variable, indicator_id, source, priority, start, end) -> dict[str, object]:
    return {
        "variable": variable,
        "indicator_id": indicator_id,
        "source": source,
        "missing_from": start.date().isoformat(),
        "missing_to": end.date().isoformat(),
        "priority": priority,
        "coverage_pct": None,
        "status": "PARTIAL",
    }
