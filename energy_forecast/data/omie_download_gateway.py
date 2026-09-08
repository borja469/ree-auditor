from __future__ import annotations

import json
from dataclasses import dataclass
from urllib import error, request

import pandas as pd

from .audit import DEFAULT_DATABASE_URL, expected_hour_index
from .esios_download_gateway import AuthRequiredError, DownloadRequest, safe_http_error, scrub_secret
from .runtime import assert_write_allowed


OMIE_MD_CODE = "5202"


@dataclass
class ExistingOmieDownloadGateway:
    """Gateway to the application's existing OMIE downloader.

    This calls the local `/omie/descargas/ejecutar` endpoint, which delegates
    mercado diario downloads to OmiePreciosService. It does not implement a
    second OMIE client.
    """

    api_base_url: str = "http://localhost:3000"
    timeout_seconds: int = 600
    auth_token: str | None = None

    def download_market_day(self, day: str) -> dict[str, object]:
        assert_write_allowed("download")
        url = f"{self.api_base_url.rstrip('/')}/omie/descargas/ejecutar?force=false"
        body = json.dumps({"codigoOmie": OMIE_MD_CODE, "fecha": day}).encode("utf-8")
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

    def ensure_omie_history(self, from_date: str, to_date: str, *, database_url: str = DEFAULT_DATABASE_URL) -> list[dict[str, object]]:
        assert_write_allowed("sync")
        results = []
        for day in missing_omie_days(database_url, from_date, to_date):
            item = DownloadRequest("omie_price", 0, day, day, "critical")
            try:
                response = self.download_market_day(day)
                results.append({"request": item.__dict__, "from": day, "to": day, "status": "SUCCESS", "response": response})
            except AuthRequiredError as exc:
                results.append({"request": item.__dict__, "from": day, "to": day, "status": exc.status, "error": exc.status})
                return results
            except Exception as exc:
                results.append({"request": item.__dict__, "from": day, "to": day, "status": "ERROR", "error": scrub_secret(str(exc), self.auth_token)})
        return results


def missing_omie_days(database_url: str, from_date: str, to_date: str) -> list[str]:
    try:
        import psycopg
    except Exception as exc:
        raise RuntimeError("Install psycopg to audit PostgreSQL: python -m pip install psycopg[binary]") from exc

    expected_by_day = {
        day.date().isoformat(): len(expected_hour_index(day.date().isoformat(), day.date().isoformat()))
        for day in pd.date_range(from_date, to_date, freq="D")
    }
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            """
            select fecha_programa::date as day,
                   count(distinct floor((periodo - 1) / 4.0)) as hours
            from omie_prices
            where tipo_precio = 'MD'
              and fecha_programa >= %s::date
              and fecha_programa <= %s::date
            group by fecha_programa::date
            """,
            (from_date, to_date),
        ).fetchall()
    available = {str(day): int(hours or 0) for day, hours in rows}
    return [day for day, expected_hours in expected_by_day.items() if available.get(day, 0) < expected_hours]
