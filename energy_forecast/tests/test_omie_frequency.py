from __future__ import annotations

import pandas as pd

from energy_forecast.data.omie_frequency import aggregate_omie_periods_to_hourly


def make_periods(day: str, periods: int) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "fecha_programa": [day] * periods,
            "periodo": list(range(1, periods + 1)),
            "precio_eur_mwh": list(range(1, periods + 1)),
        }
    )


def test_omie_quarter_hourly_normal_day_to_hourly_mean():
    hourly, meta = aggregate_omie_periods_to_hourly(make_periods("2026-01-15", 96))

    assert len(hourly) == 24
    assert hourly["omie_price"].iloc[0] == 2.5
    assert meta.iloc[0]["source_frequency"] == "quarter_hourly"
    assert meta.iloc[0]["target_frequency"] == "hourly"
    assert meta.iloc[0]["aggregation"] == "mean"


def test_omie_quarter_hourly_march_dst_day_has_23_hours():
    hourly, meta = aggregate_omie_periods_to_hourly(make_periods("2026-03-29", 92))

    assert len(hourly) == 23
    assert meta.iloc[0]["target_hours"] == 23
    assert meta.iloc[0]["periods_per_hour"] == 4


def test_omie_quarter_hourly_october_dst_day_has_25_hours():
    hourly, meta = aggregate_omie_periods_to_hourly(make_periods("2026-10-25", 100))

    assert len(hourly) == 25
    assert meta.iloc[0]["target_hours"] == 25
    assert meta.iloc[0]["periods_per_hour"] == 4
