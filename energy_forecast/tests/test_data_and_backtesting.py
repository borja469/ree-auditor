from __future__ import annotations

import pandas as pd
import pytest

from energy_forecast.backtesting.io import append_predictions
from energy_forecast.backtesting.run import wide_to_canonical
from energy_forecast.data.aliases import load_aliases, recognize_columns
from energy_forecast.data.contracts import MADRID_TZ
from energy_forecast.data.excel_adapter import ExcelAdapter, parse_date_hour
from energy_forecast.data.validation import DataValidationError, validate_availability
from energy_forecast.features.electricity_features import build_electricity_features
from energy_forecast.models.quantiles import enforce_monotonic_quantiles
from energy_forecast.scenarios import build_daily_scenarios


def test_excel_aliases_recognize_non_exact_columns():
    aliases = load_aliases()
    recognized = recognize_columns(["Fecha", "Hora", "Precio mercado diario", "Eolica Prevista"], aliases)

    assert recognized["Fecha"] == "date"
    assert recognized["Hora"] == "hour"
    assert recognized["Precio mercado diario"] == "omie_price"
    assert recognized["Eolica Prevista"] == "wind_forecast"


def test_parse_date_hour_accepts_spanish_hour_1_to_24():
    parsed = parse_date_hour(pd.Series(["01/01/2026", "01/01/2026"]), pd.Series([1, 24]))

    assert parsed.iloc[0].hour == 0
    assert parsed.iloc[1].hour == 23
    assert str(parsed.iloc[0].tzinfo) == MADRID_TZ


def test_dst_europe_madrid_nonexistent_hour_is_shifted():
    parsed = parse_date_hour(pd.Series(["29/03/2026"]), pd.Series([3]))

    assert parsed.iloc[0].tzinfo is not None
    assert parsed.iloc[0].hour == 3


def test_excel_preview_and_canonical_dataset(tmp_path):
    path = tmp_path / "forecast.xlsx"
    pd.DataFrame(
        {
            "Fecha": ["01/01/2026", "01/01/2026"],
            "Hora": [1, 2],
            "Precio mercado diario": [50.0, 52.0],
            "Prevision eolica": [6000, 6200],
        }
    ).to_excel(path, index=False)

    adapter = ExcelAdapter()
    preview = adapter.preview(path)
    dataset = adapter.load_canonical(path)

    assert preview.sheets_detected == ["Sheet1"]
    assert preview.sheets[0].columns_recognized["Precio mercado diario"] == "omie_price"
    assert set(dataset.rows["variable"]) == {"omie_price", "wind_forecast"}
    assert set(dataset.rows["data_type"]) == {"observed", "forecast"}


def test_residual_load_variants_and_import_sign():
    index = pd.date_range("2026-01-01", periods=1, freq="h", tz=MADRID_TZ)
    frame = pd.DataFrame(
        {
            "demand_forecast": [30000],
            "wind_forecast": [5000],
            "solar_forecast": [4000],
            "hydro": [3000],
            "nuclear": [6000],
            "net_imports": [2000],
        },
        index=index,
    )

    features = build_electricity_features(frame)

    assert features["rl1_demand_wind_solar"].iloc[0] == 21000
    assert features["rl2_demand_wind_solar_nuclear"].iloc[0] == 15000
    assert features["rl3_demand_wind_solar_nuclear_hydro"].iloc[0] == 12000
    assert features["rl4_demand_wind_solar_nuclear_hydro_netimports"].iloc[0] == 10000
    assert features["residual_load"].iloc[0] == 10000


def test_feature_builder_accepts_database_generation_names():
    index = pd.date_range("2026-01-01", periods=1, freq="h", tz=MADRID_TZ)
    frame = pd.DataFrame(
        {
            "demand_forecast": [30000],
            "wind_forecast": [5000],
            "solar_forecast": [4000],
            "hydro_generation": [3000],
            "nuclear_generation": [6000],
            "ccgt_generation": [2000],
        },
        index=index,
    )

    features = build_electricity_features(frame)

    assert features["hydro_generation"].iloc[0] == 3000
    assert features["nuclear_generation"].iloc[0] == 6000
    assert features["ccgt_generation"].iloc[0] == 2000
    assert features["residual_load_alt_without_imports"].iloc[0] == 12000


def test_exports_increase_residual_load_when_net_imports_negative():
    index = pd.date_range("2026-01-01", periods=1, freq="h", tz=MADRID_TZ)
    base = pd.DataFrame(
        {
            "demand_forecast": [30000],
            "wind_forecast": [5000],
            "solar_forecast": [4000],
            "hydro": [3000],
            "nuclear": [6000],
            "net_imports": [-2000],
        },
        index=index,
    )

    assert build_electricity_features(base)["residual_load"].iloc[0] == 14000


def test_leakage_blocks_backtest_inputs():
    rows = pd.DataFrame(
        {
            "timestamp": [pd.Timestamp("2026-01-02 00:00", tz=MADRID_TZ)],
            "available_at": [pd.Timestamp("2026-01-01 14:00", tz=MADRID_TZ)],
            "variable": ["wind_forecast"],
        }
    )

    with pytest.raises(DataValidationError):
        validate_availability(rows, pd.Timestamp("2026-01-01 13:00", tz=MADRID_TZ))


def test_quantile_crossing_is_corrected_and_counted():
    frame = pd.DataFrame({"p10": [10, 30], "p25": [20, 25], "p50": [30, 24], "p75": [40, 23], "p90": [50, 22]})

    corrected, crossings = enforce_monotonic_quantiles(frame)

    assert crossings == 1
    assert (corrected[["p10", "p25", "p50", "p75", "p90"]].diff(axis=1).iloc[:, 1:] >= 0).all().all()


def test_scenario_probabilities_sum_to_100():
    index = pd.date_range("2026-01-01", periods=24, freq="h", tz=MADRID_TZ)
    quantiles = pd.DataFrame({"p10": 40, "p25": 45, "p50": 50, "p75": 60, "p90": 70}, index=index)
    features = pd.DataFrame({"residual_load_pct": 0.5, "wind_share": 0.2, "solar_share": 0.1, "hydro_share": 0.1}, index=index)

    assert sum(scenario["probability"] for scenario in build_daily_scenarios(quantiles, features)) == 100


def test_forecast_append_only(tmp_path):
    path = tmp_path / "predictions.csv"
    index = pd.date_range("2026-01-01", periods=1, freq="h", tz=MADRID_TZ)
    predictions = pd.DataFrame({"p50": [50.0], "actual": [51.0]}, index=index)

    append_predictions(path, predictions)
    append_predictions(path, predictions)

    assert len(pd.read_csv(path)) == 2


def test_database_wide_frame_converts_to_canonical_availability():
    index = pd.date_range("2026-01-02", periods=1, freq="h", tz=MADRID_TZ)
    wide = pd.DataFrame({"omie_price": [50.0], "demand_forecast": [30000.0]}, index=index)

    dataset = wide_to_canonical(wide)

    rows = dataset.rows.set_index("variable")
    assert rows.loc["omie_price", "data_type"] == "observed"
    assert rows.loc["omie_price", "available_at"] == index[0]
    assert rows.loc["demand_forecast", "data_type"] == "forecast"
    assert rows.loc["demand_forecast", "available_at"] == pd.Timestamp("2026-01-01 13:00", tz=MADRID_TZ)
