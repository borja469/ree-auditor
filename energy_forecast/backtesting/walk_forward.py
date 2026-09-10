from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from energy_forecast.data.contracts import canonical_to_wide, ensure_madrid_timestamp
from energy_forecast.data.validation import validate_availability
from energy_forecast.models.baselines import PreviousDayBaseline, PreviousWeekBaseline
from energy_forecast.models.calibration import HourlyBiasCalibrator, split_train_calibration
from energy_forecast.models.quantiles import enforce_monotonic_quantiles


@dataclass
class BacktestResult:
    metrics: dict[str, float | dict[str, float]]
    predictions: pd.DataFrame


def walk_forward_validation(
    features: pd.DataFrame,
    target: pd.Series,
    model_factory,
    *,
    initial_train_days: int = 180,
    quantiles: list[float] | None = None,
) -> BacktestResult:
    quantiles = quantiles or [0.10, 0.25, 0.50, 0.75, 0.90]
    predictions = []
    days = sorted(pd.Index(target.index.normalize().unique()))
    for day in days[initial_train_days:]:
        train_mask = target.index.normalize() < day
        test_mask = target.index.normalize() == day
        if train_mask.sum() < 24 or test_mask.sum() == 0:
            continue
        X_train, y_train = features.loc[train_mask], target.loc[train_mask]
        X_test, y_test = features.loc[test_mask], target.loc[test_mask]
        model = model_factory()
        model.fit(X_train, y_train)
        quantile_frame, crossing_count = enforce_monotonic_quantiles(model.predict_quantiles(X_test, quantiles))
        baseline_day = PreviousDayBaseline().fit(X_train, y_train).predict(X_test)
        baseline_week = PreviousWeekBaseline().fit(X_train, y_train).predict(X_test)
        frame = quantile_frame.copy()
        frame["actual"] = y_test
        frame["baseline_previous_day"] = baseline_day
        frame["baseline_previous_week"] = baseline_week
        frame["quantile_crossings_before_correction"] = crossing_count
        predictions.append(frame)
    all_predictions = pd.concat(predictions).sort_index() if predictions else pd.DataFrame()
    return BacktestResult(metrics=calculate_metrics(all_predictions, features), predictions=all_predictions)


def walk_forward_canonical_dayahead(
    canonical_rows: pd.DataFrame,
    model_factory,
    *,
    from_date: str,
    to_date: str,
    forecast_hour: str = "13:00",
    target_variable: str = "omie_price",
    feature_builder=None,
    selector=None,
    min_train_days: int = 30,
    training_window_days: int | None = None,
    training_window_label: str | None = None,
    hourly_bias_alpha: float = 0.0,
    calibration_fraction: float = 0.4,
    quantiles: list[float] | None = None,
) -> BacktestResult:
    from energy_forecast.features.electricity_features import build_electricity_features
    from energy_forecast.pipeline import select_model_features

    feature_builder = feature_builder or build_electricity_features
    selector = selector or select_model_features
    quantiles = quantiles or [0.10, 0.25, 0.50, 0.75, 0.90]
    rows = canonical_rows.copy()
    rows["timestamp"] = pd.to_datetime(rows["timestamp"], utc=True).dt.tz_convert("Europe/Madrid")
    target_rows = rows[(rows["variable"] == target_variable) & (rows["data_type"] == "observed")]
    target = (
        target_rows.sort_values("available_at")
        .drop_duplicates(["timestamp"], keep="last")
        .set_index("timestamp")["value"]
        .sort_index()
    )
    predictions = []
    for origin_day in pd.date_range(from_date, to_date, freq="D", tz="Europe/Madrid"):
        hour, minute = [int(part) for part in forecast_hour.split(":", 1)]
        origin = ensure_madrid_timestamp(origin_day.replace(hour=hour, minute=minute))
        target_day = (origin + pd.Timedelta(days=1)).normalize()
        horizon = pd.date_range(target_day, periods=24, freq="h", tz="Europe/Madrid")
        y_test = target.reindex(horizon)
        if y_test.isna().all():
            continue
        predictor_rows = rows[(rows["variable"] != target_variable) | (rows["timestamp"] < target_day)]
        used_predictor_rows = predictor_rows[predictor_rows["available_at"] <= origin]
        validate_availability(used_predictor_rows, origin)
        wide = canonical_to_wide(used_predictor_rows, forecast_origin=origin)
        features = feature_builder(wide).dropna(axis=1, how="all")
        train_mask = features.index < target_day
        if training_window_days is not None:
            train_mask = train_mask & (features.index >= target_day - pd.Timedelta(days=training_window_days))
        test_mask = features.index.isin(horizon)
        if train_mask.sum() < min_train_days * 24 or test_mask.sum() == 0:
            continue
        aligned_target = target.reindex(features.index)
        train_target = aligned_target.loc[train_mask].dropna()
        if len(train_target) < min_train_days * 24:
            continue
        X_train = selector(features.loc[train_target.index])
        X_test = selector(features.loc[test_mask])
        fill_values = X_train.median(numeric_only=True).fillna(0)
        X_train = X_train.fillna(fill_values)
        X_test = X_test.reindex(columns=X_train.columns).ffill().bfill().fillna(fill_values)
        model = model_factory()
        fit_X, fit_y, calibration_X, calibration_y = split_train_calibration(
            X_train,
            train_target,
            calibration_fraction=calibration_fraction,
        )
        model.fit(fit_X, fit_y)
        calibrator = HourlyBiasCalibrator(alpha=hourly_bias_alpha)
        if not calibration_y.empty:
            calibration_frame, _ = enforce_monotonic_quantiles(model.predict_quantiles(calibration_X, quantiles))
            calibrator.fit(calibration_frame["p50"], calibration_y)
        quantile_frame, crossing_count = enforce_monotonic_quantiles(model.predict_quantiles(X_test, quantiles))
        quantile_frame = calibrator.apply(quantile_frame)
        frame = quantile_frame.copy()
        frame["actual"] = y_test.reindex(frame.index)
        frame["forecast_origin"] = origin
        frame["target_date"] = target_day.date().isoformat()
        frame["daily_mean_p50"] = float(frame["p50"].mean())
        frame["daily_quantile_method"] = "hourly_quantile_average_proxy"
        frame["quantile_crossings_before_correction"] = crossing_count
        frame["training_window"] = training_window_label or (f"{training_window_days}d" if training_window_days else "expanding")
        frame["n_training_rows"] = int(len(train_target))
        frame["calibration_alpha"] = float(hourly_bias_alpha)
        frame["n_calibration_rows"] = int(len(calibration_y))
        frame["baseline_previous_day"] = PreviousDayBaseline().fit(X_train, train_target).predict(X_test)
        frame["baseline_previous_week"] = PreviousWeekBaseline().fit(X_train, train_target).predict(X_test)
        predictions.append(frame)
    all_predictions = pd.concat(predictions).sort_index() if predictions else pd.DataFrame()
    return BacktestResult(metrics=calculate_metrics(all_predictions, feature_builder(canonical_to_wide(rows))), predictions=all_predictions)


def calculate_metrics(predictions: pd.DataFrame, features: pd.DataFrame) -> dict[str, float | dict[str, float]]:
    if predictions.empty:
        return {}
    error = predictions["p50"] - predictions["actual"]
    metrics: dict[str, float | dict[str, float]] = {
        "mae": float(error.abs().mean()),
        "rmse": float((error.pow(2).mean()) ** 0.5),
        "bias": float(error.mean()),
        "coverage_p10_p90": float(((predictions["actual"] >= predictions["p10"]) & (predictions["actual"] <= predictions["p90"])).mean()),
        "coverage_p25_p75": float(((predictions["actual"] >= predictions["p25"]) & (predictions["actual"] <= predictions["p75"])).mean()),
        "mae_baseline_previous_day": float((predictions["baseline_previous_day"] - predictions["actual"]).abs().mean()),
        "rmse_baseline_previous_day": float(((predictions["baseline_previous_day"] - predictions["actual"]).pow(2).mean()) ** 0.5),
        "bias_baseline_previous_day": float((predictions["baseline_previous_day"] - predictions["actual"]).mean()),
        "mae_baseline_previous_week": float((predictions["baseline_previous_week"] - predictions["actual"]).abs().mean()),
        "rmse_baseline_previous_week": float(((predictions["baseline_previous_week"] - predictions["actual"]).pow(2).mean()) ** 0.5),
        "bias_baseline_previous_week": float((predictions["baseline_previous_week"] - predictions["actual"]).mean()),
    }
    metrics["daily_mae"] = float(error.abs().groupby(predictions.index.normalize()).mean().mean())
    metrics["mae_by_day"] = error.abs().groupby(predictions.index.normalize()).mean().to_dict()
    if metrics["mae_baseline_previous_day"]:
        metrics["improvement_vs_d1_pct"] = float((1 - metrics["mae"] / metrics["mae_baseline_previous_day"]) * 100)
    if metrics["mae_baseline_previous_week"]:
        metrics["improvement_vs_d7_pct"] = float((1 - metrics["mae"] / metrics["mae_baseline_previous_week"]) * 100)
    metrics["mae_by_hour"] = error.abs().groupby(predictions.index.hour).mean().to_dict()
    metrics["mae_by_month"] = error.abs().groupby(predictions.index.month).mean().to_dict()
    metrics["mae_weekday_weekend"] = error.abs().groupby(predictions.index.dayofweek >= 5).mean().to_dict()
    joined = features.reindex(predictions.index)
    if "residual_load" in joined:
        metrics["mae_by_residual_load_quintile"] = (
            error.abs().groupby(pd.qcut(joined["residual_load"], 5, duplicates="drop"), observed=False).mean().astype(float).to_dict()
        )
    if "wind_forecast" in joined:
        metrics["mae_by_wind_quintile"] = (
            error.abs().groupby(pd.qcut(joined["wind_forecast"], 5, duplicates="drop"), observed=False).mean().astype(float).to_dict()
        )
    if "demand_forecast" in joined:
        metrics["mae_by_demand_quintile"] = (
            error.abs().groupby(pd.qcut(joined["demand_forecast"], 5, duplicates="drop"), observed=False).mean().astype(float).to_dict()
        )
    for q in [0.10, 0.25, 0.50, 0.75, 0.90]:
        col = f"p{int(q * 100)}"
        diff = predictions["actual"] - predictions[col]
        metrics[f"pinball_p{int(q * 100)}"] = float(pd.concat([q * diff, (q - 1) * diff], axis=1).max(axis=1).mean())
    return metrics
