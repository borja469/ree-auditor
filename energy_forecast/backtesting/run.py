from __future__ import annotations

import argparse
import json
from pathlib import Path

from energy_forecast.backtesting.io import append_predictions
from energy_forecast.backtesting.walk_forward import walk_forward_canonical_dayahead
from energy_forecast.diagnostics import summarize_bias_diagnosis, write_bias_diagnosis
from energy_forecast.data.contracts import MADRID_TZ
from energy_forecast.data.excel_adapter import ExcelAdapter
from energy_forecast.models.gradient_boosting import GradientBoostingForecastModel


def main() -> int:
    parser = argparse.ArgumentParser(description="Run OMIE D+1 walk-forward backtest.")
    parser.add_argument("--from", dest="from_date", required=True)
    parser.add_argument("--to", dest="to_date", required=True)
    parser.add_argument("--forecast-hour", default="13:00")
    parser.add_argument("--input", required=True, help="Path to an .xlsx file with hourly market data.")
    parser.add_argument("--output", default="energy_forecast/output/backtest_predictions.csv")
    parser.add_argument("--diagnosis-output", default="reports/model_bias_diagnosis.csv")
    parser.add_argument("--min-train-days", type=int, default=30)
    parser.add_argument("--training-windows", default="30,90,180,expanding")
    parser.add_argument("--n-estimators", type=int, default=60)
    parser.add_argument("--allow-incomplete-data", action="store_true")
    args = parser.parse_args()

    adapter = ExcelAdapter()
    preview = adapter.preview(args.input)
    dataset = adapter.load_canonical(args.input)
    blockers = validate_input_readiness(dataset.rows, args.from_date, args.to_date)
    if blockers and not args.allow_incomplete_data:
        print(json.dumps({"preview": preview.to_dict(), "status": "BLOCKED_INCOMPLETE_DATA", "blocking_requirements": blockers}, indent=2))
        print("Backtest blocked. Use --allow-incomplete-data only for diagnostics, not model selection.")
        return 3
    results = {}
    all_predictions = []
    last_features = None
    for window in parse_windows(args.training_windows):
        label = "expanding" if window is None else f"{window}d"
        result = walk_forward_canonical_dayahead(
            dataset.rows,
            lambda: GradientBoostingForecastModel(mode="global", n_estimators=args.n_estimators),
            from_date=args.from_date,
            to_date=args.to_date,
            forecast_hour=args.forecast_hour,
            min_train_days=args.min_train_days,
            training_window_days=window,
            training_window_label=label,
        )
        results[label] = result
        if not result.predictions.empty:
            all_predictions.append(result.predictions)
    if all_predictions:
        import pandas as pd
        from energy_forecast.data.contracts import canonical_to_wide
        from energy_forecast.features.electricity_features import build_electricity_features

        predictions = pd.concat(all_predictions).sort_index()
        append_predictions(args.output, predictions)
        last_features = build_electricity_features(canonical_to_wide(dataset.rows))
        diagnosis = write_bias_diagnosis(args.diagnosis_output, predictions, last_features)
        diagnosis_summary = summarize_bias_diagnosis(diagnosis)
    else:
        predictions = None
        diagnosis_summary = {"status": "empty"}
    print(
        json.dumps(
            {
                "preview": preview.to_dict(),
                "metrics_by_window": {label: stringify_keys(result.metrics) for label, result in results.items()},
                "diagnosis_summary": stringify_keys(diagnosis_summary),
                "predictions": 0 if predictions is None else len(predictions),
            },
            indent=2,
        )
    )
    if predictions is None:
        print("No predictions generated. Check date range, target omie_price, and minimum training rows.")
        return 2
    print(f"Predictions appended to {Path(args.output).resolve()}")
    print(f"Bias diagnosis written to {Path(args.diagnosis_output).resolve()}")
    return 0


def stringify_keys(value):
    if isinstance(value, dict):
        return {str(key): stringify_keys(item) for key, item in value.items()}
    return value


def parse_windows(value: str) -> list[int | None]:
    windows: list[int | None] = []
    for item in value.split(","):
        token = item.strip().lower()
        if not token:
            continue
        if token == "expanding":
            windows.append(None)
        else:
            windows.append(int(token))
    return windows


def validate_input_readiness(rows, from_date: str, to_date: str) -> list[dict[str, object]]:
    import pandas as pd

    required = {"omie_price": 95.0, "demand_forecast": 95.0, "wind_forecast": 90.0}
    start = (pd.Timestamp(from_date) + pd.Timedelta(days=1)).tz_localize(MADRID_TZ)
    end = (pd.Timestamp(to_date) + pd.Timedelta(days=2)).tz_localize(MADRID_TZ)
    expected = pd.date_range(start, end, freq="h", inclusive="left")
    frame = rows.copy()
    if frame.empty or len(expected) == 0:
        return [{"variable": "dataset", "coverage_pct": 0.0, "required_coverage_pct": 95.0, "status": "MISSING"}]
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True).dt.tz_convert(MADRID_TZ)
    blockers = []
    for variable, minimum in required.items():
        timestamps = set(frame.loc[frame["variable"] == variable, "timestamp"])
        matched = len(set(expected).intersection(timestamps))
        coverage = 0.0 if len(expected) == 0 else round(matched / len(expected) * 100, 4)
        if coverage < minimum:
            blockers.append({"variable": variable, "coverage_pct": coverage, "required_coverage_pct": minimum, "status": "PARTIAL" if matched else "MISSING"})
    return blockers


if __name__ == "__main__":
    raise SystemExit(main())
