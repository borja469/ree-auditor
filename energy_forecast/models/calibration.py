from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from energy_forecast.models.quantiles import QUANTILE_COLUMNS


@dataclass
class HourlyBiasCalibrator:
    alpha: float = 0.5
    hourly_bias: pd.Series = field(default_factory=lambda: pd.Series(dtype="float64"))

    def fit(self, predictions: pd.Series, actual: pd.Series) -> "HourlyBiasCalibrator":
        aligned = pd.concat([predictions.rename("prediction"), actual.rename("actual")], axis=1).dropna()
        if aligned.empty or self.alpha <= 0:
            self.hourly_bias = pd.Series(dtype="float64")
            return self
        self.hourly_bias = (aligned["prediction"] - aligned["actual"]).groupby(aligned.index.hour).mean()
        return self

    def apply(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty or self.hourly_bias.empty or self.alpha <= 0:
            return frame.copy()
        result = frame.copy()
        columns = [column for column in QUANTILE_COLUMNS if column in result.columns]
        correction = result.index.hour.map(self.hourly_bias).fillna(0).astype("float64")
        for column in columns:
            result[column] = result[column] - self.alpha * correction
        return result


def split_train_calibration(
    X: pd.DataFrame,
    y: pd.Series,
    *,
    calibration_fraction: float = 0.4,
    min_calibration_rows: int = 24,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]:
    if not 0 < calibration_fraction < 1:
        return X, y, X.iloc[0:0], y.iloc[0:0]
    dates = sorted(pd.Index(y.index.normalize().unique()))
    if len(dates) < 3:
        return X, y, X.iloc[0:0], y.iloc[0:0]
    cutoff_date = dates[max(1, int(len(dates) * (1 - calibration_fraction)))]
    fit_mask = y.index.normalize() < cutoff_date
    calibration_mask = y.index.normalize() >= cutoff_date
    if int(fit_mask.sum()) < min_calibration_rows or int(calibration_mask.sum()) < min_calibration_rows:
        return X, y, X.iloc[0:0], y.iloc[0:0]
    return X.loc[fit_mask], y.loc[fit_mask], X.loc[calibration_mask], y.loc[calibration_mask]
