from __future__ import annotations

from datetime import datetime

import pandas as pd

from energy_forecast.data.contracts import MADRID_TZ
from energy_forecast.data.esios_adapter import EsiosAdapter
from energy_forecast.features.electricity_features import build_electricity_features
from energy_forecast.indices.pressure import compute_omie_pressure_index
from energy_forecast.models.baselines import PreviousDayBaseline, PreviousWeekBaseline


class FakeProvider:
    def load_hourly_indicators(self, start, end, indicators):
        index = pd.date_range(start=start, end=end, freq="h", tz=MADRID_TZ)
        hour = pd.Series(index.hour, index=index)
        return pd.DataFrame(
            {
                "demanda_prevista": 28000 + hour * 10,
                "prevision_eolica": 6500,
                "prevision_solar": hour.map(lambda value: 5000 if 9 <= value <= 18 else 0),
                "hidraulica": 2500,
                "nuclear": 7000,
                "total_net_import": 1000,
                "omie_price": 45 + hour * 0.5,
            },
            index=index,
        )


def test_feature_builder_keeps_residual_load_formula():
    adapter = EsiosAdapter(FakeProvider())
    raw = adapter.load_hourly(datetime(2026, 1, 1), datetime(2026, 1, 2))
    features = build_electricity_features(raw)

    expected = raw["demanda_prevista"] - raw["prevision_eolica"] - raw["prevision_solar"] - raw["hidraulica"] - raw["nuclear"] - raw["total_net_import"]
    pd.testing.assert_series_equal(features["residual_load"], expected, check_names=False, check_dtype=False)


def test_pressure_index_reweights_available_components():
    adapter = EsiosAdapter(FakeProvider())
    features = build_electricity_features(adapter.load_hourly(datetime(2026, 1, 1), datetime(2026, 1, 2)))
    score, detail = compute_omie_pressure_index(features)

    assert score.between(0, 100).all()
    assert "gas" in detail["missing_variables"].iloc[0]


def test_baselines_predict_previous_periods():
    index = pd.date_range("2026-01-01", periods=24 * 8, freq="h", tz=MADRID_TZ)
    y = pd.Series(range(len(index)), index=index)
    X = pd.DataFrame({"hour": index.hour}, index=index[-24:])

    assert PreviousDayBaseline().fit(X, y).predict(X).iloc[0] == len(index) - 48
    assert PreviousWeekBaseline().fit(X, y).predict(X).iloc[0] == len(index) - 24 * 8
