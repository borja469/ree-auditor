from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import pandas as pd

from .contracts import CANONICAL_COLUMNS, MADRID_TZ, CanonicalDataset


class EsiosProvider(Protocol):
    def load_hourly_indicators(self, start, end, indicators) -> pd.DataFrame:
        ...


@dataclass
class EsiosAdapter:
    provider: EsiosProvider
    indicators: dict[str, str] | None = None
    observed_variables: set[str] = field(
        default_factory=lambda: {
            "omie_price",
            "demand",
            "wind",
            "solar",
            "hydro",
            "nuclear",
            "net_imports",
            "ccgt_generation",
            "mibgas",
            "ttf",
            "eua",
            "omip",
            "temperature",
        }
    )

    def load_hourly(self, start, end) -> pd.DataFrame:
        frame = self.provider.load_hourly_indicators(start, end, self.indicators)
        if not isinstance(frame.index, pd.DatetimeIndex):
            raise ValueError("ESIOS provider must return a DataFrame indexed by timestamp.")
        if frame.index.tz is None:
            frame.index = frame.index.tz_localize(MADRID_TZ, ambiguous="infer", nonexistent="shift_forward")
        else:
            frame.index = frame.index.tz_convert(MADRID_TZ)
        return frame.sort_index()

    def load_canonical(self, start, end, *, source: str = "esios") -> CanonicalDataset:
        wide = self.load_hourly(start, end)
        rows = []
        for timestamp, values in wide.iterrows():
            for variable, value in values.dropna().items():
                rows.append(
                    {
                        "timestamp": timestamp,
                        "forecast_origin": pd.NaT,
                        "available_at": timestamp,
                        "variable": variable,
                        "value": float(value),
                        "unit": infer_unit(variable),
                        "source": source,
                        "status": "raw",
                        "data_type": "observed" if variable in self.observed_variables else "forecast",
                    }
                )
        return CanonicalDataset(pd.DataFrame(rows, columns=CANONICAL_COLUMNS))


def infer_unit(variable: str) -> str | None:
    if variable == "omie_price" or variable in {"mibgas", "ttf", "eua", "omip"}:
        return "EUR/MWh"
    if any(token in variable for token in ["demand", "wind", "solar", "hydro", "nuclear", "import", "ccgt"]):
        return "MW"
    if "temperature" in variable:
        return "C"
    return None
