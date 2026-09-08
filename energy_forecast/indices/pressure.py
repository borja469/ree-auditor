from __future__ import annotations

import pandas as pd


THEORETICAL_WEIGHTS = {
    "gas": 0.25,
    "wind_forecast": 0.15,
    "hydro_generation": 0.15,
    "solar_forecast": 0.10,
    "demand_forecast": 0.10,
    "nuclear_generation": 0.10,
    "total_net_import": 0.05,
    "carbon": 0.05,
    "forward": 0.05,
}


def compute_omie_pressure_index(features: pd.DataFrame) -> tuple[pd.Series, pd.DataFrame]:
    components = pd.DataFrame(index=features.index)
    components["wind_forecast"] = inverse_percentile(features.get("wind_forecast"))
    components["hydro_generation"] = inverse_percentile(features.get("hydro_generation"))
    components["solar_forecast"] = inverse_percentile(features.get("solar_forecast"))
    components["demand_forecast"] = percentile(features.get("demand_forecast"))
    components["nuclear_generation"] = inverse_percentile(features.get("nuclear_generation"))
    components["total_net_import"] = inverse_percentile(features.get("total_net_import"))

    available = [column for column in components.columns if components[column].notna().any()]
    effective_weight_sum = sum(THEORETICAL_WEIGHTS[column] for column in available)
    score = pd.Series(50.0, index=features.index)
    if effective_weight_sum:
        score = sum(
            components[column].fillna(50) * (THEORETICAL_WEIGHTS[column] / effective_weight_sum)
            for column in available
        )
    detail = components.copy()
    for column in THEORETICAL_WEIGHTS:
        detail[f"{column}__theoretical_weight"] = THEORETICAL_WEIGHTS[column]
        detail[f"{column}__effective_weight"] = (
            THEORETICAL_WEIGHTS[column] / effective_weight_sum if column in available and effective_weight_sum else 0.0
        )
    detail["missing_variables"] = ",".join(sorted(set(THEORETICAL_WEIGHTS) - set(available)))
    return score.clip(0, 100).rename("omie_pressure_index"), detail


def percentile(series: pd.Series | None) -> pd.Series:
    if series is None:
        return pd.Series(dtype="float64")
    return series.rank(pct=True) * 100


def inverse_percentile(series: pd.Series | None) -> pd.Series:
    ranked = percentile(series)
    return 100 - ranked

