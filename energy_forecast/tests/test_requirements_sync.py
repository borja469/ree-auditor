from __future__ import annotations

from io import BytesIO
from urllib.error import HTTPError

import pytest

from energy_forecast.data.esios_download_gateway import AuthRequiredError, ExistingEsiosDownloadGateway, split_monthly
from energy_forecast.data.omie_download_gateway import ExistingOmieDownloadGateway
from energy_forecast.data.requirements import coalesce_missing_ranges
from energy_forecast.data.runtime import ReadOnlyViolation
from energy_forecast.storage.forecast_store import ForecastStore


def test_split_monthly_keeps_month_boundaries():
    assert split_monthly("2025-01-15", "2025-03-02") == [
        ("2025-01-15", "2025-01-31"),
        ("2025-02-01", "2025-02-28"),
        ("2025-03-01", "2025-03-02"),
    ]


def test_coalesce_missing_ranges_deduplicates_dst_same_day():
    items = [
        {"variable": "demand_forecast", "indicator_id": 460, "source": "esios", "missing_from": "2025-10-26", "missing_to": "2025-10-26", "priority": "critical"},
        {"variable": "demand_forecast", "indicator_id": 460, "source": "esios", "missing_from": "2025-10-26", "missing_to": "2025-10-26", "priority": "critical"},
        {"variable": "demand_forecast", "indicator_id": 460, "source": "esios", "missing_from": "2025-10-27", "missing_to": "2025-10-27", "priority": "critical"},
    ]

    assert coalesce_missing_ranges(items) == [
        {
            "variable": "demand_forecast",
            "indicator_id": 460,
            "source": "esios",
            "missing_from": "2025-10-26",
            "missing_to": "2025-10-27",
            "priority": "critical",
            "coverage_pct": None,
            "status": "PARTIAL",
        }
    ]


def test_esios_gateway_maps_401_to_auth_required(monkeypatch):
    def raise_401(*args, **kwargs):
        raise HTTPError("http://localhost", 401, "Unauthorized", {}, BytesIO(b'{"message":"Sesion no valida"}'))

    monkeypatch.setattr("energy_forecast.data.esios_download_gateway.request.urlopen", raise_401)
    gateway = ExistingEsiosDownloadGateway(auth_token="secret-token")

    with pytest.raises(AuthRequiredError):
        gateway.download_indicator(460, "2025-01-01", "2025-01-31")


def test_omie_gateway_maps_401_to_auth_required(monkeypatch):
    def raise_401(*args, **kwargs):
        raise HTTPError("http://localhost", 401, "Unauthorized", {}, BytesIO(b'{"message":"Sesion no valida"}'))

    monkeypatch.setattr("energy_forecast.data.omie_download_gateway.request.urlopen", raise_401)
    gateway = ExistingOmieDownloadGateway(auth_token="secret-token")

    with pytest.raises(AuthRequiredError):
        gateway.download_market_day("2025-01-01")


def test_read_only_blocks_esios_download_before_http(monkeypatch):
    def fail_http(*args, **kwargs):
        raise AssertionError("HTTP must not be called in read-only mode")

    monkeypatch.setenv("ENERGY_FORECAST_READ_ONLY", "true")
    monkeypatch.setattr("energy_forecast.data.esios_download_gateway.request.urlopen", fail_http)

    with pytest.raises(ReadOnlyViolation):
        ExistingEsiosDownloadGateway(auth_token="secret-token").download_indicator(460, "2025-01-01", "2025-01-31")


def test_read_only_blocks_omie_download_before_http(monkeypatch):
    def fail_http(*args, **kwargs):
        raise AssertionError("HTTP must not be called in read-only mode")

    monkeypatch.setenv("ENERGY_FORECAST_READ_ONLY", "true")
    monkeypatch.setattr("energy_forecast.data.omie_download_gateway.request.urlopen", fail_http)

    with pytest.raises(ReadOnlyViolation):
        ExistingOmieDownloadGateway(auth_token="secret-token").download_market_day("2025-01-01")


def test_read_only_blocks_forecast_persistence(monkeypatch):
    monkeypatch.setenv("ENERGY_FORECAST_READ_ONLY", "true")

    with pytest.raises(ReadOnlyViolation):
        ForecastStore(connection=object()).save_run(
            forecast_origin=None,
            target_date="2025-01-02",
            model_version="test",
            dataset_version="test",
            feature_version="test",
            hourly=None,
            input_snapshot=None,
        )
