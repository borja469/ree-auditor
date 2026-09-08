from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

MADRID_TZ = "Europe/Madrid"


CANONICAL_COLUMNS = [
    "timestamp",
    "forecast_origin",
    "available_at",
    "variable",
    "value",
    "unit",
    "source",
    "status",
    "data_type",
]


@dataclass(frozen=True)
class CanonicalDataset:
    rows: pd.DataFrame

    def __post_init__(self) -> None:
        missing = [column for column in CANONICAL_COLUMNS if column not in self.rows.columns]
        if missing:
            raise ValueError(f"Canonical dataset missing columns: {missing}")

    def to_wide(self, *, forecast_origin: pd.Timestamp | None = None) -> pd.DataFrame:
        return canonical_to_wide(self.rows, forecast_origin=forecast_origin)


def ensure_madrid_timestamp(value) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize(MADRID_TZ, ambiguous="infer", nonexistent="shift_forward")
    return timestamp.tz_convert(MADRID_TZ)


def canonical_to_wide(rows: pd.DataFrame, *, forecast_origin: pd.Timestamp | None = None) -> pd.DataFrame:
    frame = rows.copy()
    if frame.empty:
        return pd.DataFrame()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True).dt.tz_convert(MADRID_TZ)
    frame["available_at"] = pd.to_datetime(frame["available_at"], utc=True).dt.tz_convert(MADRID_TZ)
    if forecast_origin is not None:
        origin = ensure_madrid_timestamp(forecast_origin)
        frame = frame[frame["available_at"] <= origin]
    frame = frame.sort_values(["timestamp", "variable", "available_at"])
    latest = frame.drop_duplicates(["timestamp", "variable"], keep="last")
    wide = latest.pivot(index="timestamp", columns="variable", values="value").sort_index()
    wide.columns.name = None
    for column in wide.columns:
        converted = pd.to_numeric(wide[column], errors="coerce")
        if converted.notna().any():
            wide[column] = converted
    return wide
