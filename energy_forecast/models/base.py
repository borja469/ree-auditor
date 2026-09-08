from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

import pandas as pd


class ForecastModel(ABC):
    @abstractmethod
    def fit(self, X: pd.DataFrame, y: pd.Series) -> "ForecastModel":
        raise NotImplementedError

    @abstractmethod
    def predict(self, X: pd.DataFrame) -> pd.Series:
        raise NotImplementedError

    @abstractmethod
    def predict_quantiles(self, X: pd.DataFrame, quantiles: list[float]) -> pd.DataFrame:
        raise NotImplementedError

    @abstractmethod
    def save(self, path: str | Path) -> None:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def load(cls, path: str | Path) -> "ForecastModel":
        raise NotImplementedError

