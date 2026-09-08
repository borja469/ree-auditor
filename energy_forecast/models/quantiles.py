from __future__ import annotations

import pandas as pd

QUANTILE_COLUMNS = ["p10", "p25", "p50", "p75", "p90"]


def enforce_monotonic_quantiles(frame: pd.DataFrame, columns: list[str] | None = None) -> tuple[pd.DataFrame, int]:
    columns = columns or [column for column in QUANTILE_COLUMNS if column in frame.columns]
    if len(columns) < 2:
        return frame.copy(), 0
    result = frame.copy()
    crossing = pd.Series(False, index=result.index)
    for left, right in zip(columns, columns[1:]):
        crossing = crossing | (result[left] > result[right])
    crossing_count = int(crossing.sum())
    result.loc[:, columns] = result.loc[:, columns].cummax(axis=1)
    return result, crossing_count
