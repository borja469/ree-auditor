from __future__ import annotations

import json
from dataclasses import dataclass
from urllib import error, request

import pandas as pd

from .runtime import assert_write_allowed


class AuthRequiredError(RuntimeError):
    """Raised when the existing application rejects the internal request."""

    status = "AUTH_REQUIRED"


@dataclass(frozen=True)
class DownloadRequest:
    variable: str
    indicator_id: int
    from_date: str
    to_date: str
    priority: str


@dataclass
class ExistingEsiosDownloadGateway:
    """Gateway to the application's existing ESIOS downloader.

    This intentionally calls the local application endpoint that wraps
    EsiosApiService.downloadIndicator. It does not call the ESIOS API directly.
    """

    api_base_url: str = "http://localhost:3000"
    timeout_seconds: int = 600
    auth_token: str | None = None

    @property
    def source(self) -> str:
        return "esios"

    def download_indicator(self, indicator_id: int, from_date: str, to_date: str) -> dict[str, object]:
        assert_write_allowed("download")
        url = f"{self.api_base_url.rstrip('/')}/esios/indicators/{indicator_id}/download"
        body = json.dumps({"startDate": from_date, "endDate": to_date}).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        req = request.Request(url, data=body, method="POST", headers=headers)
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                payload = response.read().decode("utf-8")
            return json.loads(payload) if payload else {}
        except error.HTTPError as exc:
            if exc.code == 401:
                raise AuthRequiredError("AUTH_REQUIRED: internal application token required") from exc
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(safe_http_error(exc.code, body or exc.reason)) from exc

    def ensure_indicator_history(self, downloads: list[DownloadRequest]) -> list[dict[str, object]]:
        assert_write_allowed("sync")
        results = []
        for item in downloads:
            for start, end in split_monthly(item.from_date, item.to_date):
                try:
                    response = self.download_indicator(item.indicator_id, start, end)
                    results.append({"request": item.__dict__, "from": start, "to": end, "status": "SUCCESS", "response": response})
                except AuthRequiredError as exc:
                    results.append({"request": item.__dict__, "from": start, "to": end, "status": exc.status, "error": exc.status})
                    return results
                except Exception as exc:
                    results.append({"request": item.__dict__, "from": start, "to": end, "status": "ERROR", "error": scrub_secret(str(exc), self.auth_token)})
        return results


def split_monthly(from_date: str, to_date: str) -> list[tuple[str, str]]:
    start = pd.Timestamp(from_date).date()
    end = pd.Timestamp(to_date).date()
    ranges: list[tuple[str, str]] = []
    current = start
    while current <= end:
        month_end = (pd.Timestamp(current).replace(day=1) + pd.offsets.MonthEnd(0)).date()
        chunk_end = min(month_end, end)
        ranges.append((current.isoformat(), chunk_end.isoformat()))
        current = (pd.Timestamp(chunk_end) + pd.Timedelta(days=1)).date()
    return ranges


def safe_http_error(status_code: int, body: str) -> str:
    if status_code == 401:
        return "AUTH_REQUIRED"
    return f"HTTP {status_code}: {body[:300]}"


def scrub_secret(value: str, secret: str | None) -> str:
    if not secret:
        return value
    return value.replace(secret, "[REDACTED]")
