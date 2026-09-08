from __future__ import annotations

import pandas as pd


def build_ccgt_proxy_target(features: pd.DataFrame) -> pd.Series:
    residual = features["residual_load"].rank(pct=True)
    ccgt = features.get("ccgt_generation", pd.Series(index=features.index, dtype="float64")).rank(pct=True)
    price = features.get("omie_price", pd.Series(index=features.index, dtype="float64")).rank(pct=True)
    proxy = ((residual >= 0.65) & ((ccgt >= 0.60) | (price >= 0.65))).astype(int)
    proxy.name = "thermal_marginality_proxy"
    proxy.attrs["target_type"] = "proxy"
    return proxy


def compute_ccgt_marginality_index(features: pd.DataFrame) -> pd.DataFrame:
    residual_score = features["residual_load"].rank(pct=True).fillna(0.5) * 100
    wind_relief = features.get("wind_share", pd.Series(index=features.index, dtype="float64")).rank(pct=True).fillna(0.5) * 20
    solar_relief = features.get("solar_share", pd.Series(index=features.index, dtype="float64")).rank(pct=True).fillna(0.5) * 15
    hydro_relief = features.get("hydro_share", pd.Series(index=features.index, dtype="float64")).rank(pct=True).fillna(0.5) * 15
    price_stress = features.get("omie_rolling_mean_7d", pd.Series(index=features.index, dtype="float64")).rank(pct=True).fillna(0.5) * 30
    need_probability = (residual_score - wind_relief - solar_relief - hydro_relief).clip(0, 100)
    marginality_probability = (0.65 * need_probability + 0.35 * price_stress).clip(0, 100)
    return pd.DataFrame(
        {
            "ccgt_need_probability": need_probability,
            "ccgt_marginality_probability": marginality_probability,
            "ccgt_marginality_index": marginality_probability,
        },
        index=features.index,
    )
