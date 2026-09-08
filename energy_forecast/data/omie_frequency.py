from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .contracts import MADRID_TZ


@dataclass(frozen=True)
class OmieAggregationMetadata:
    source_frequency: str
    target_frequency: str
    aggregation: str
    source_periods: int
    target_hours: int
    periods_per_hour: float


def aggregate_omie_periods_to_hourly(
    periods: pd.DataFrame,
    *,
    date_column: str = "fecha_programa",
    period_column: str = "periodo",
    value_column: str = "precio_eur_mwh",
    timezone: str = MADRID_TZ,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows = []
    metadata_rows = []
    frame = periods.copy()
    frame[date_column] = pd.to_datetime(frame[date_column]).dt.date
    for day, group in frame.groupby(date_column, sort=True):
        group = group.sort_values(period_column)
        start = pd.Timestamp(day).tz_localize(timezone)
        end = (pd.Timestamp(day) + pd.Timedelta(days=1)).tz_localize(timezone)
        local_hours = pd.date_range(start, end, freq="h", inclusive="left")
        source_periods = int(group[period_column].nunique())
        target_hours = len(local_hours)
        if source_periods <= target_hours and int(group[period_column].max()) <= target_hours:
            periods_per_hour = 1.0
        else:
            periods_per_hour = source_periods / target_hours
        if periods_per_hour <= 0:
            continue
        grouped = group.copy()
        grouped["hour_offset"] = ((grouped[period_column].astype(float) - 1) / periods_per_hour).astype(int)
        grouped = grouped[(grouped["hour_offset"] >= 0) & (grouped["hour_offset"] < target_hours)]
        hourly = grouped.groupby("hour_offset", sort=True)[value_column].mean()
        for offset, value in hourly.items():
            rows.append({"timestamp": local_hours[int(offset)], "omie_price": float(value)})
        metadata_rows.append(
            {
                "date": pd.Timestamp(day).date().isoformat(),
                "source_frequency": "quarter_hourly" if periods_per_hour > 1 else "hourly",
                "target_frequency": "hourly",
                "aggregation": "mean",
                "source_periods": source_periods,
                "target_hours": target_hours,
                "periods_per_hour": periods_per_hour,
            }
        )
    hourly_frame = pd.DataFrame(rows)
    if hourly_frame.empty:
        return pd.DataFrame(columns=["omie_price"]), pd.DataFrame(metadata_rows)
    hourly_frame = hourly_frame.groupby("timestamp", as_index=True)["omie_price"].mean().to_frame().sort_index()
    return hourly_frame, pd.DataFrame(metadata_rows)
