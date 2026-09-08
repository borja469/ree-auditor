from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .aliases import load_aliases, recognize_columns
from .contracts import CANONICAL_COLUMNS, MADRID_TZ, CanonicalDataset
from .esios_adapter import infer_unit


FORECAST_VARIABLE_HINTS = ("forecast", "prevista", "previsto", "prevision", "previsión", "expected", "programada", "scheduled", "proxy")


@dataclass
class SheetPreview:
    sheet_name: str
    columns_detected: list[str]
    columns_recognized: dict[str, str]
    columns_unrecognized: list[str]
    temporal_range: dict[str, str | None]
    frequency: str | None
    records: int
    gaps: int
    duplicates: int
    timezone: str | None
    inferred_units: dict[str, str | None]


@dataclass
class ExcelPreview:
    path: str
    sheets_detected: list[str]
    sheets: list[SheetPreview]

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "sheets_detected": self.sheets_detected,
            "sheets": [sheet.__dict__ for sheet in self.sheets],
        }


class ExcelAdapter:
    def __init__(self, alias_path: str | Path | None = None, *, source: str = "excel_manual"):
        self.aliases = load_aliases(alias_path)
        self.source = source

    def preview(self, path: str | Path) -> ExcelPreview:
        workbook = pd.read_excel(path, sheet_name=None)
        sheets = [self._preview_sheet(name, frame) for name, frame in workbook.items()]
        return ExcelPreview(path=str(path), sheets_detected=list(workbook.keys()), sheets=sheets)

    def load_canonical(self, path: str | Path, *, available_at=None, forecast_origin=None) -> CanonicalDataset:
        workbook = pd.read_excel(path, sheet_name=None)
        rows = []
        for sheet_name, frame in workbook.items():
            prepared, recognized = self._prepare_sheet(frame)
            if prepared.empty:
                continue
            timestamps = prepared.pop("timestamp")
            for original_column, variable in recognized.items():
                if variable in {"timestamp", "date", "hour"} or original_column not in prepared.columns:
                    continue
                values = pd.to_numeric(prepared[original_column], errors="coerce")
                for timestamp, value in zip(timestamps, values):
                    if pd.isna(timestamp) or pd.isna(value):
                        continue
                    timestamp = _to_madrid(timestamp)
                    data_type = infer_data_type(variable, original_column)
                    rows.append(
                        {
                            "timestamp": timestamp,
                            "forecast_origin": pd.Timestamp(forecast_origin) if forecast_origin is not None else pd.NaT,
                            "available_at": _to_madrid(available_at) if available_at is not None else default_available_at(timestamp, data_type),
                            "variable": variable,
                            "value": float(value),
                            "unit": infer_unit(variable),
                            "source": f"{self.source}:{sheet_name}",
                            "status": "raw",
                            "data_type": data_type,
                        }
                    )
        return CanonicalDataset(pd.DataFrame(rows, columns=CANONICAL_COLUMNS))

    def _preview_sheet(self, name: str, frame: pd.DataFrame) -> SheetPreview:
        prepared, recognized = self._prepare_sheet(frame)
        timestamps = prepared["timestamp"] if "timestamp" in prepared else pd.Series(dtype="datetime64[ns]")
        non_time_columns = {key: value for key, value in recognized.items() if value not in {"timestamp", "date", "hour"}}
        return SheetPreview(
            sheet_name=name,
            columns_detected=[str(column) for column in frame.columns],
            columns_recognized=recognized,
            columns_unrecognized=[str(column) for column in frame.columns if str(column) not in recognized],
            temporal_range={
                "start": timestamps.min().isoformat() if len(timestamps.dropna()) else None,
                "end": timestamps.max().isoformat() if len(timestamps.dropna()) else None,
            },
            frequency=infer_frequency(timestamps),
            records=int(len(frame)),
            gaps=count_hourly_gaps(timestamps),
            duplicates=int(timestamps.duplicated().sum()) if len(timestamps) else 0,
            timezone=str(getattr(getattr(timestamps, "dt", None), "tz", None)),
            inferred_units={variable: infer_unit(variable) for variable in non_time_columns.values()},
        )

    def _prepare_sheet(self, frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, str]]:
        prepared = frame.copy()
        recognized = recognize_columns(list(prepared.columns), self.aliases)
        timestamp_col = next((col for col, canonical in recognized.items() if canonical == "timestamp"), None)
        date_col = next((col for col, canonical in recognized.items() if canonical == "date"), None)
        hour_col = next((col for col, canonical in recognized.items() if canonical == "hour"), None)
        if timestamp_col and timestamp_col in prepared:
            prepared["timestamp"] = parse_timestamp_series(prepared[timestamp_col])
        elif date_col and hour_col and date_col in prepared and hour_col in prepared:
            prepared["timestamp"] = parse_date_hour(prepared[date_col], prepared[hour_col])
            recognized["timestamp"] = "timestamp"
        elif date_col and date_col in prepared:
            prepared["timestamp"] = parse_timestamp_series(prepared[date_col])
            recognized["timestamp"] = "timestamp"
        return prepared, recognized


def preview_excel(path: str | Path, alias_path: str | Path | None = None) -> ExcelPreview:
    return ExcelAdapter(alias_path).preview(path)


def parse_timestamp_series(series: pd.Series) -> pd.Series:
    text = series.astype(str)
    iso_like = text.str.match(r"^\d{4}-\d{1,2}-\d{1,2}")
    parsed = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    if iso_like.any():
        parsed.loc[iso_like] = pd.to_datetime(series.loc[iso_like], errors="coerce", dayfirst=False)
    if (~iso_like).any():
        parsed.loc[~iso_like] = pd.to_datetime(series.loc[~iso_like], errors="coerce", dayfirst=True)
    return parsed.map(lambda value: _to_madrid(value) if pd.notna(value) else pd.NaT)


def parse_date_hour(date_series: pd.Series, hour_series: pd.Series) -> pd.Series:
    dates = pd.to_datetime(date_series, errors="coerce", dayfirst=True)
    hours = hour_series.map(_parse_hour_value)
    combined = dates + pd.to_timedelta(hours, unit="h")
    return combined.map(lambda value: _to_madrid(value) if pd.notna(value) else pd.NaT)


def _parse_hour_value(value) -> int:
    if pd.isna(value):
        return 0
    if isinstance(value, str) and ":" in value:
        return int(value.split(":", 1)[0])
    hour = int(value)
    return hour - 1 if 1 <= hour <= 24 else hour


def _to_madrid(value) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize(MADRID_TZ, ambiguous=True, nonexistent="shift_forward")
    return timestamp.tz_convert(MADRID_TZ)


def infer_frequency(timestamps: pd.Series) -> str | None:
    clean = pd.DatetimeIndex(timestamps.dropna().sort_values())
    if len(clean) < 3:
        return None
    inferred = pd.infer_freq(clean)
    if inferred:
        return inferred
    delta = clean.to_series().diff().dropna().mode()
    return str(delta.iloc[0]) if not delta.empty else None


def count_hourly_gaps(timestamps: pd.Series) -> int:
    clean = pd.DatetimeIndex(timestamps.dropna().sort_values().drop_duplicates())
    if len(clean) < 2:
        return 0
    expected = pd.date_range(clean.min(), clean.max(), freq="h", tz=clean.tz)
    return int(len(expected.difference(clean)))


def infer_data_type(variable: str, original_column: str) -> str:
    text = f"{variable} {original_column}".lower()
    if any(hint in text for hint in FORECAST_VARIABLE_HINTS):
        return "forecast"
    return "observed"


def default_available_at(timestamp: pd.Timestamp, data_type: str) -> pd.Timestamp:
    if data_type == "forecast":
        return timestamp.normalize() - pd.Timedelta(hours=11)
    return timestamp
