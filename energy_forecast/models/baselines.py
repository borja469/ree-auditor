from __future__ import annotations

from pathlib import Path
import pickle

import pandas as pd

from .base import ForecastModel


class LagBaseline(ForecastModel):
    def __init__(self, lag_hours: int):
        self.lag_hours = lag_hours
        self.history: pd.Series | None = None

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "LagBaseline":
        self.history = y.copy().sort_index()
        return self

    def predict(self, X: pd.DataFrame) -> pd.Series:
        if self.history is None:
            raise ValueError("Model is not fitted.")
        values = []
        for timestamp in X.index:
            source_timestamp = timestamp - pd.Timedelta(hours=self.lag_hours)
            values.append(self.history.get(source_timestamp, float("nan")))
        return pd.Series(values, index=X.index, name="forecast_p50")

    def predict_quantiles(self, X: pd.DataFrame, quantiles: list[float]) -> pd.DataFrame:
        prediction = self.predict(X)
        return pd.DataFrame({f"p{int(q * 100)}": prediction for q in quantiles}, index=X.index)

    def save(self, path: str | Path) -> None:
        with Path(path).open("wb") as handle:
            pickle.dump({"lag_hours": self.lag_hours, "history": self.history}, handle)

    @classmethod
    def load(cls, path: str | Path) -> "LagBaseline":
        with Path(path).open("rb") as handle:
            payload = pickle.load(handle)
        model = cls(payload["lag_hours"])
        model.history = payload["history"]
        return model


class PreviousDayBaseline(LagBaseline):
    def __init__(self):
        super().__init__(24)


class PreviousWeekBaseline(LagBaseline):
    def __init__(self):
        super().__init__(168)
