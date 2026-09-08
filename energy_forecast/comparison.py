from __future__ import annotations

import pandas as pd


def compare_with_previous_forecast(current: pd.DataFrame, previous: pd.DataFrame | None) -> pd.DataFrame:
    result = current.copy()
    if previous is None or previous.empty:
        result["previous_p50"] = pd.NA
        result["delta_vs_previous_p50"] = pd.NA
        result["daily_delta_vs_previous_p50"] = pd.NA
        return result
    aligned_previous = previous.reindex(result.index)
    result["previous_p50"] = aligned_previous["p50"]
    result["delta_vs_previous_p50"] = result["p50"] - result["previous_p50"]
    result["daily_delta_vs_previous_p50"] = result["delta_vs_previous_p50"].mean()
    return result

