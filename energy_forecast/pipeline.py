from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .data.esios_adapter import EsiosAdapter
from .data.validation import validate_hourly_frame
from .features.electricity_features import build_electricity_features
from .indices.ccgt_marginality import compute_ccgt_marginality_index
from .indices.pressure import compute_omie_pressure_index
from .models.calibration import HourlyBiasCalibrator, split_train_calibration
from .models.gradient_boosting import GradientBoostingForecastModel
from .models.quantiles import enforce_monotonic_quantiles
from .scenarios import build_daily_scenarios

FEATURE_VERSION = "energy_forecast_features_v1"


@dataclass
class EnergyForecastEngine:
    esios_adapter: EsiosAdapter
    model: GradientBoostingForecastModel | None = None
    calibrator: HourlyBiasCalibrator | None = None

    def train(
        self,
        start,
        end,
        *,
        mode: str = "global",
        hourly_bias_alpha: float = 0.5,
        calibration_fraction: float = 0.4,
    ) -> dict[str, object]:
        raw = self.esios_adapter.load_hourly(start, end)
        report = validate_hourly_frame(raw, require_target=True)
        report.raise_if_blocking()
        features = build_electricity_features(raw).dropna(axis=1, how="all")
        dataset = features.dropna(subset=["omie_price"])
        X = select_model_features(dataset)
        y = dataset["omie_price"]
        fit_X, fit_y, calibration_X, calibration_y = split_train_calibration(
            X,
            y,
            calibration_fraction=calibration_fraction,
        )
        self.model = GradientBoostingForecastModel(mode=mode).fit(fit_X, fit_y)
        self.calibrator = HourlyBiasCalibrator(alpha=hourly_bias_alpha)
        if not calibration_y.empty:
            calibration_quantiles, _ = enforce_monotonic_quantiles(
                self.model.predict_quantiles(calibration_X, [0.10, 0.25, 0.50, 0.75, 0.90])
            )
            self.calibrator.fit(calibration_quantiles["p50"], calibration_y)
        return {
            "model_type": "gradient_boosting",
            "mode": mode,
            "hourly_bias_alpha": hourly_bias_alpha,
            "calibration_rows": len(calibration_y),
            "feature_version": FEATURE_VERSION,
            "features": list(X.columns),
            "rows": len(X),
            "validation_issues": [issue.__dict__ for issue in report.issues],
        }

    def predict_day(self, start, end, *, forecast_origin) -> dict[str, object]:
        if self.model is None:
            raise ValueError("Train or load a model before prediction.")
        raw = self.esios_adapter.load_hourly(start, end)
        report = validate_hourly_frame(raw, forecast_origin=pd.Timestamp(forecast_origin))
        report.raise_if_blocking()
        features = build_electricity_features(raw).dropna(axis=1, how="all")
        X = select_model_features(features)
        quantiles, crossing_count = enforce_monotonic_quantiles(self.model.predict_quantiles(X, [0.10, 0.25, 0.50, 0.75, 0.90]))
        if self.calibrator is not None:
            quantiles = self.calibrator.apply(quantiles)
        ccgt = compute_ccgt_marginality_index(features)
        pressure, pressure_detail = compute_omie_pressure_index(features)
        hourly = quantiles.join(ccgt).join(pressure)
        daily_mean = hourly[["p10", "p25", "p50", "p75", "p90"]].mean().to_dict()
        return {
            "hourly": hourly,
            "daily_mean": daily_mean,
            "daily_p10_p90": [float(hourly["p10"].mean()), float(hourly["p90"].mean())],
            "daily_p25_p75": [float(hourly["p25"].mean()), float(hourly["p75"].mean())],
            "daily_quantile_method": "hourly_quantile_average_proxy",
            "quantile_crossings_before_correction": crossing_count,
            "scenarios": build_daily_scenarios(quantiles, features),
            "pressure_components": pressure_detail,
            "validation_issues": [issue.__dict__ for issue in report.issues],
            "data_sections": {
                "observed": [col for col in raw.columns if not col.endswith("_prevista")],
                "input_forecast": [col for col in raw.columns if "prevision" in col or "prevista" in col],
                "model_estimation": [
                    "p10",
                    "p25",
                    "p50",
                    "p75",
                    "p90",
                    "ccgt_need_probability",
                    "ccgt_marginality_probability",
                    "omie_pressure_index",
                ],
            },
        }


def select_model_features(frame: pd.DataFrame) -> pd.DataFrame:
    leakage = {"omie_price", "ccgt_generation"}
    candidates = frame.select_dtypes(include="number").drop(columns=[c for c in leakage if c in frame.columns], errors="ignore")
    return candidates.dropna(axis=1, thresh=max(24, int(len(candidates) * 0.5))).ffill().bfill()
