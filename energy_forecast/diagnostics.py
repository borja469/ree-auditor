from __future__ import annotations

from pathlib import Path

import pandas as pd


def build_bias_diagnosis(predictions: pd.DataFrame, features: pd.DataFrame) -> pd.DataFrame:
    if predictions.empty:
        return pd.DataFrame()
    joined = predictions.copy()
    joined["prediction"] = joined["p50"]
    joined["actual_omie"] = joined["actual"]
    joined["error"] = joined["prediction"] - joined["actual_omie"]
    joined["hour"] = joined.index.hour
    feature_columns = [
        "demand_forecast",
        "wind_forecast",
        "solar_forecast",
        "solar_expected",
        "residual_load",
        "forecastable_residual_load",
        "forecastable_residual_load_components_available",
    ]
    available = [column for column in feature_columns if column in features.columns]
    joined = joined.join(features[available], how="left")
    columns = [
        "forecast_origin",
        "target_date",
        "actual_omie",
        "prediction",
        "error",
        "demand_forecast",
        "wind_forecast",
        "solar_forecast",
        "solar_expected",
        "residual_load",
        "forecastable_residual_load",
        "forecastable_residual_load_components_available",
        "hour",
        "training_window",
        "n_training_rows",
        "calibration_alpha",
        "n_calibration_rows",
    ]
    return joined[[column for column in columns if column in joined.columns]]


def write_bias_diagnosis(path: str | Path, predictions: pd.DataFrame, features: pd.DataFrame) -> pd.DataFrame:
    diagnosis = build_bias_diagnosis(predictions, features)
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    diagnosis.to_csv(output, index_label="timestamp")
    return diagnosis


def summarize_bias_diagnosis(diagnosis: pd.DataFrame) -> dict[str, object]:
    if diagnosis.empty:
        return {"status": "empty"}
    error = diagnosis["error"]
    summary: dict[str, object] = {
        "rows": int(len(diagnosis)),
        "bias": float(error.mean()),
        "mae": float(error.abs().mean()),
        "median_absolute_error": float(error.abs().median()),
        "positive_error_pct": float((error > 0).mean() * 100),
    }
    for column in ["demand_forecast", "wind_forecast", "solar_expected", "forecastable_residual_load"]:
        if column in diagnosis and diagnosis[column].notna().any():
            summary[f"corr_error_{column}"] = float(diagnosis[["error", column]].corr().iloc[0, 1])
    return summary
