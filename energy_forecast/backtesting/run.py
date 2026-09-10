from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from energy_forecast.backtesting.io import append_predictions
from energy_forecast.backtesting.walk_forward import walk_forward_canonical_dayahead
from energy_forecast.diagnostics import summarize_bias_diagnosis, write_bias_diagnosis
from energy_forecast.data.audit import DEFAULT_DATABASE_URL, audit_database
from energy_forecast.data.contracts import CANONICAL_COLUMNS, MADRID_TZ, CanonicalDataset
from energy_forecast.data.esios_adapter import infer_unit
from energy_forecast.data.esios_database_provider import SystemDatabaseProvider
from energy_forecast.data.excel_adapter import ExcelAdapter
from energy_forecast.data.runtime import load_runtime_config
from energy_forecast.models.gradient_boosting import GradientBoostingForecastModel


def main() -> int:
    runtime = load_runtime_config()
    parser = argparse.ArgumentParser(description="Run OMIE D+1 walk-forward backtest.")
    parser.add_argument("--from", dest="from_date", required=True)
    parser.add_argument("--to", dest="to_date", required=True)
    parser.add_argument("--forecast-hour", default="13:00")
    parser.add_argument("--input", help="Path to an .xlsx file with hourly market data.")
    parser.add_argument("--database-url", default=runtime.database_url or DEFAULT_DATABASE_URL)
    parser.add_argument("--output", default="energy_forecast/output/backtest_predictions.csv")
    parser.add_argument("--diagnosis-output", default="reports/model_bias_diagnosis.csv")
    parser.add_argument("--min-train-days", type=int, default=30)
    parser.add_argument("--training-windows", default="30,90,180,expanding")
    parser.add_argument("--n-estimators", type=int, default=60)
    parser.add_argument("--hourly-bias-alpha", type=float, default=0.5)
    parser.add_argument("--calibration-fraction", type=float, default=0.4)
    parser.add_argument("--allow-incomplete-data", action="store_true")
    args = parser.parse_args()

    dataset, preview = load_backtest_dataset(args)
    blockers = validate_input_readiness(dataset.rows, args.from_date, args.to_date)
    if blockers and not args.allow_incomplete_data:
        print(json.dumps({"preview": preview, "status": "BLOCKED_INCOMPLETE_DATA", "blocking_requirements": blockers}, indent=2))
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
            hourly_bias_alpha=args.hourly_bias_alpha,
            calibration_fraction=args.calibration_fraction,
        )
        results[label] = result
        if not result.predictions.empty:
            all_predictions.append(result.predictions)
    if all_predictions:
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
                "preview": stringify_keys(preview),
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


def load_backtest_dataset(args) -> tuple[CanonicalDataset, dict[str, object]]:
    if args.input:
        adapter = ExcelAdapter()
        preview = adapter.preview(args.input).to_dict()
        return adapter.load_canonical(args.input), preview
    if not args.database_url:
        raise SystemExit("DATABASE_URL_REQUIRED: pass --input for Excel or DATABASE_URL/--database-url for PostgreSQL.")
    return load_database_dataset(args.database_url, args.from_date, args.to_date)


def load_database_dataset(database_url: str, from_date: str, to_date: str) -> tuple[CanonicalDataset, dict[str, object]]:
    try:
        import psycopg
    except Exception as exc:
        raise RuntimeError("Install psycopg to load PostgreSQL: python -m pip install psycopg[binary]") from exc

    audit_rows = audit_database(database_url, from_date, to_date)
    indicator_mapping = build_database_indicator_mapping(audit_rows)
    data_kinds = {str(row["variable"]): str(row.get("data_kind") or "") for row in audit_rows}
    with psycopg.connect(database_url) as connection:
        provider = SystemDatabaseProvider(connection=connection, indicator_mapping=indicator_mapping)
        wide = provider.load_hourly_indicators(from_date, to_date)
    dataset = wide_to_canonical(wide, data_kinds=data_kinds)
    preview = {
        "source": "postgresql",
        "variables": sorted(str(column) for column in wide.columns),
        "indicator_mapping": {key: int(value) for key, value in sorted(indicator_mapping.items())},
        "rows": int(len(dataset.rows)),
        "start": wide.index.min().isoformat() if not wide.empty else None,
        "end": wide.index.max().isoformat() if not wide.empty else None,
        "timezone": MADRID_TZ,
    }
    return dataset, preview


def build_database_indicator_mapping(audit_rows: list[dict[str, object]]) -> dict[str, int]:
    mapping = {}
    for row in audit_rows:
        if row.get("source") != "esios" or row.get("mapping_status") != "MAPPED":
            continue
        indicator_id = row.get("indicator_id")
        if not indicator_id:
            continue
        mapping[str(row["variable"])] = int(indicator_id)
    return mapping


def wide_to_canonical(wide: pd.DataFrame, *, data_kinds: dict[str, str] | None = None) -> CanonicalDataset:
    data_kinds = data_kinds or {}
    rows = []
    for timestamp, values in wide.sort_index().iterrows():
        timestamp = pd.Timestamp(timestamp)
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize(MADRID_TZ, ambiguous=True, nonexistent="shift_forward")
        else:
            timestamp = timestamp.tz_convert(MADRID_TZ)
        for variable, value in values.items():
            if pd.isna(value):
                continue
            data_type = infer_database_data_type(str(variable), data_kinds.get(str(variable)))
            rows.append(
                {
                    "timestamp": timestamp,
                    "forecast_origin": pd.NaT,
                    "available_at": default_database_available_at(timestamp, data_type),
                    "variable": str(variable),
                    "value": float(value),
                    "unit": infer_unit(str(variable)),
                    "source": "postgresql",
                    "status": "loaded",
                    "data_type": data_type,
                }
            )
    return CanonicalDataset(pd.DataFrame(rows, columns=CANONICAL_COLUMNS))


def infer_database_data_type(variable: str, data_kind: str | None) -> str:
    if variable in {"mibgas", "gas"}:
        return "forecast"
    if data_kind in {"FORECAST", "SCHEDULED", "PROXY"}:
        return "forecast"
    if data_kind == "OBSERVED":
        return "observed"
    if variable.endswith("_forecast") or variable.endswith("_expected"):
        return "forecast"
    return "observed"


def default_database_available_at(timestamp: pd.Timestamp, data_type: str) -> pd.Timestamp:
    if data_type == "forecast":
        return timestamp.normalize() - pd.Timedelta(hours=11)
    return timestamp


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
