from __future__ import annotations

import os
from dataclasses import dataclass


TRUE_VALUES = {"1", "true", "yes", "y", "on"}
WRITE_OPERATIONS = {
    "download",
    "sync",
    "insert",
    "update",
    "delete",
    "persist_forecast",
    "save_run",
}


class ReadOnlyViolation(RuntimeError):
    pass


@dataclass(frozen=True)
class RuntimeConfig:
    environment: str
    read_only: bool
    database_url: str | None
    backend_base_url: str | None
    app_auth_token: str | None


def load_runtime_config() -> RuntimeConfig:
    environment = os.environ.get("ENERGY_FORECAST_ENV", "dev").strip().lower() or "dev"
    return RuntimeConfig(
        environment=environment,
        read_only=is_read_only(),
        database_url=os.environ.get("DATABASE_URL") or os.environ.get("PROD_DATABASE_URL"),
        backend_base_url=os.environ.get("BACKEND_BASE_URL") or os.environ.get("ENERGY_FORECAST_APP_API_URL"),
        app_auth_token=os.environ.get("ENERGY_FORECAST_APP_AUTH_TOKEN"),
    )


def is_read_only() -> bool:
    return os.environ.get("ENERGY_FORECAST_READ_ONLY", "").strip().lower() in TRUE_VALUES


def assert_write_allowed(operation: str) -> None:
    if is_read_only() and operation in WRITE_OPERATIONS:
        raise ReadOnlyViolation(
            f"ENERGY_FORECAST_READ_ONLY=true blocks write operation: {operation}"
        )
