from __future__ import annotations

import pandas as pd


def build_daily_scenarios(hourly_quantiles: pd.DataFrame, features: pd.DataFrame) -> list[dict[str, object]]:
    daily = hourly_quantiles.mean(numeric_only=True)
    p10 = float(daily.get("p10", daily.min()))
    p25 = float(daily.get("p25", p10))
    p50 = float(daily.get("p50", daily.mean()))
    p75 = float(daily.get("p75", p50))
    p90 = float(daily.get("p90", daily.max()))
    spread = max(p90 - p10, 0.01)
    low_prob = max(15, min(40, round(100 * (p50 - p25) / spread)))
    high_prob = max(15, min(40, round(100 * (p75 - p50) / spread)))
    central_prob = 100 - low_prob - high_prob
    drivers = daily_drivers(features)
    return [
        {
            "name": "BAJISTA",
            "probability": low_prob,
            "daily_omie_range": [p10, p25],
            "main_drivers": drivers["bearish"],
            "conditions": ["lower residual load", "higher wind/solar/hydro", "lower thermal need"],
        },
        {
            "name": "CENTRAL",
            "probability": central_prob,
            "daily_omie_range": [p25, p75],
            "main_drivers": drivers["central"],
            "conditions": ["inputs close to central forecast"],
        },
        {
            "name": "ALCISTA",
            "probability": high_prob,
            "daily_omie_range": [p75, p90],
            "main_drivers": drivers["bullish"],
            "conditions": ["higher residual load", "lower renewables/imports", "higher thermal need"],
        },
    ]


def daily_drivers(features: pd.DataFrame) -> dict[str, list[str]]:
    ranked = features.mean(numeric_only=True)
    bullish = []
    bearish = []
    if ranked.get("residual_load_pct", 0) > 0.5:
        bullish.append("residual_load")
    if ranked.get("wind_share", 0) > 0.25:
        bearish.append("wind_forecast")
    if ranked.get("solar_share", 0) > 0.12:
        bearish.append("solar_forecast")
    if ranked.get("hydro_share", 0) > 0.08:
        bearish.append("hydro_generation")
    return {"bullish": bullish[:5], "bearish": bearish[:5], "central": ["p50 probabilistic forecast"]}

