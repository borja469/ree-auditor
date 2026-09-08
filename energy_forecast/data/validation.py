from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .contracts import MADRID_TZ, ensure_madrid_timestamp


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    severity: str = "warning"
    variable: str | None = None
    count: int | None = None


class DataValidationError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        details = "; ".join(f"{issue.code}: {issue.message}" for issue in issues)
        super().__init__(details)


@dataclass
class ValidationReport:
    issues: list[ValidationIssue]

    def raise_if_blocking(self) -> None:
        blocking = [issue for issue in self.issues if issue.severity == "error"]
        if blocking:
            raise DataValidationError(blocking)


def validate_hourly_frame(
    frame: pd.DataFrame,
    *,
    forecast_origin: pd.Timestamp | None = None,
    require_target: bool = False,
) -> ValidationReport:
    issues: list[ValidationIssue] = []
    if not isinstance(frame.index, pd.DatetimeIndex):
        issues.append(ValidationIssue("index_not_datetime", "Hourly frame index must be a DatetimeIndex.", "error"))
        return ValidationReport(issues)
    if frame.index.tz is None:
        issues.append(ValidationIssue("timezone_missing", "Hourly frame index must be timezone-aware.", "error"))
    duplicates = int(frame.index.duplicated().sum())
    if duplicates:
        issues.append(ValidationIssue("duplicate_timestamps", "Duplicate timestamps found.", "error", count=duplicates))
    if len(frame.index) > 1:
        expected = pd.date_range(frame.index.min(), frame.index.max(), freq="h", tz=frame.index.tz)
        missing = expected.difference(frame.index)
        if len(missing):
            issues.append(ValidationIssue("hourly_gaps", "Missing hourly timestamps found.", "warning", count=len(missing)))
    if require_target and "omie_price" not in frame.columns:
        issues.append(ValidationIssue("target_missing", "omie_price target is required.", "error", variable="omie_price"))
    if forecast_origin is not None and "available_at" in frame.columns:
        leakage = frame["available_at"] > ensure_madrid_timestamp(forecast_origin)
        if leakage.any():
            issues.append(ValidationIssue("availability_leakage", "Rows have available_at after forecast_origin.", "error", count=int(leakage.sum())))
    return ValidationReport(issues)


def validate_availability(rows: pd.DataFrame, forecast_origin: pd.Timestamp) -> None:
    if rows.empty:
        return
    origin = ensure_madrid_timestamp(forecast_origin)
    available_at = pd.to_datetime(rows["available_at"], utc=True).dt.tz_convert(MADRID_TZ)
    leaking = rows[available_at > origin]
    if leaking.empty:
        return
    counts = leaking.groupby("variable").size().sort_values(ascending=False)
    issues = [
        ValidationIssue(
            "availability_leakage",
            f"{variable} has {count} rows with available_at after forecast_origin {origin.isoformat()}.",
            "error",
            variable=str(variable),
            count=int(count),
        )
        for variable, count in counts.items()
    ]
    raise DataValidationError(issues)
