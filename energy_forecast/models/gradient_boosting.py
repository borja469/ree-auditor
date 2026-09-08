from __future__ import annotations

from pathlib import Path
import pickle

import pandas as pd

from .base import ForecastModel


class GradientBoostingForecastModel(ForecastModel):
    """Tree boosting model with quantile heads.

    Uses LightGBM when installed, otherwise falls back to scikit-learn gradient
    boosting. This keeps the module runnable in the current repo while allowing
    LightGBM/CatBoost to be plugged in later.
    """

    def __init__(self, mode: str = "global", random_state: int = 42, n_estimators: int = 120):
        if mode not in {"global", "hourly"}:
            raise ValueError("mode must be 'global' or 'hourly'.")
        self.mode = mode
        self.random_state = random_state
        self.n_estimators = n_estimators
        self.point_model = None
        self.quantile_models: dict[float, object] = {}
        self.hourly_models: dict[int, GradientBoostingForecastModel] = {}

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "GradientBoostingForecastModel":
        if self.mode == "hourly":
            self.hourly_models = {}
            for hour in sorted(X.index.hour.unique()):
                mask = X.index.hour == hour
                model = GradientBoostingForecastModel(mode="global", random_state=self.random_state, n_estimators=self.n_estimators)
                model.fit(X.loc[mask], y.loc[mask])
                self.hourly_models[int(hour)] = model
            return self
        self.point_model = self._new_model(loss="squared_error")
        self.point_model.fit(X, y)
        self.quantile_models = {}
        for quantile in [0.10, 0.25, 0.50, 0.75, 0.90]:
            model = self._new_model(loss="quantile", alpha=quantile)
            model.fit(X, y)
            self.quantile_models[quantile] = model
        return self

    def predict(self, X: pd.DataFrame) -> pd.Series:
        if self.mode == "hourly":
            values = pd.Series(index=X.index, dtype="float64")
            for hour, model in self.hourly_models.items():
                mask = X.index.hour == hour
                if mask.any():
                    values.loc[mask] = model.predict(X.loc[mask])
            return values
        if self.point_model is None:
            raise ValueError("Model is not fitted.")
        return pd.Series(self.point_model.predict(X), index=X.index, name="forecast_p50")

    def predict_quantiles(self, X: pd.DataFrame, quantiles: list[float]) -> pd.DataFrame:
        if self.mode == "hourly":
            result = pd.DataFrame(index=X.index)
            for quantile in quantiles:
                result[f"p{int(quantile * 100)}"] = float("nan")
            for hour, model in self.hourly_models.items():
                mask = X.index.hour == hour
                if mask.any():
                    result.loc[mask, :] = model.predict_quantiles(X.loc[mask], quantiles)
            return result
        if not self.quantile_models:
            raise ValueError("Model is not fitted.")
        return pd.DataFrame(
            {f"p{int(q * 100)}": self.quantile_models[q].predict(X) for q in quantiles},
            index=X.index,
        )

    def save(self, path: str | Path) -> None:
        with Path(path).open("wb") as handle:
            pickle.dump(self, handle)

    @classmethod
    def load(cls, path: str | Path) -> "GradientBoostingForecastModel":
        with Path(path).open("rb") as handle:
            return pickle.load(handle)

    def _new_model(self, *, loss: str, alpha: float | None = None):
        try:
            import lightgbm as lgb

            objective = "regression" if loss == "squared_error" else "quantile"
            params = {"objective": objective, "random_state": self.random_state, "n_estimators": self.n_estimators}
            if alpha is not None:
                params["alpha"] = alpha
            return lgb.LGBMRegressor(**params)
        except Exception:
            from sklearn.ensemble import GradientBoostingRegressor

            params = {"loss": loss, "random_state": self.random_state, "n_estimators": self.n_estimators, "max_depth": 3}
            if alpha is not None:
                params["alpha"] = alpha
            return GradientBoostingRegressor(**params)
