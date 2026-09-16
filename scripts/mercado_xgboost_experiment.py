#!/usr/bin/env python
"""Offline XGBoost experiment for mercado D+1 forecasts.

The script reads production-like data through the local API, trains an
XGBoost regressor outside the NestJS forecast model registry, and evaluates
specific days without writing to the database or activating any model.
"""

from __future__ import annotations

import argparse
import csv
import getpass
import json
import math
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

try:
    from xgboost import XGBRegressor
except ImportError as exc:  # pragma: no cover - runtime guard for PRO
    raise SystemExit("Falta xgboost. Instala o ejecuta en el entorno donde ya este disponible.") from exc


D1_FEATURES = [
    "hour",
    "month",
    "weekday",
    "isWeekend",
    "festivoNacional",
    "demandaPrevista",
    "demandaResidual",
    "huecoTermicoD1",
    "eolica",
    "eolicaSobreDemandaPct",
    "solarPrevista",
    "solarSobreDemandaPct",
    "solarPctOfDailyMax",
    "solarDropFromDailyMax",
    "solarResidualDemandLow",
    "windPressurePct",
    "solarPressureHigh",
    "precioOmieLag24Night",
    "precioOmieLag48Night",
    "nuclearDisponibleMw",
    "nuclearDisponibleSobreDemandaPct",
    "nuclearPressureLow",
    "hidraulicaStorageIndex",
    "hidraulicaStoragePctOfMax",
    "hidraulicaStorageLow",
    "precioGasMibgas",
    "rampaDemanda",
    "rampaEolica",
    "rampaSolar",
    "rampaHuecoTermicoD1",
    "eveningThermalGapPressure",
    "eveningSolarExitThermalGap",
    "season_winter",
    "season_spring",
    "season_summer",
    "season_autumn",
]

NUCLEAR_AVAILABLE_LOW_THRESHOLD_MW = 7000.0
HYDRAULIC_STORAGE_HIGH_REFERENCE = 15_500_000.0
HYDRAULIC_STORAGE_LOW_THRESHOLD = 12_500_000.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train/evaluate XGBoost D+1 forecast through the local API.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="API base URL.")
    parser.add_argument("--username", default=os.getenv("REE_AUDITOR_USER", "operaciones"), help="Login user.")
    parser.add_argument("--password-env", default="REE_AUDITOR_PASSWORD", help="Environment variable containing the password.")
    parser.add_argument("--token-env", default="REE_AUDITOR_TOKEN", help="Environment variable containing a bearer token.")
    parser.add_argument("--train-from", default="2025-01-01")
    parser.add_argument("--train-to", default="2026-09-15")
    parser.add_argument("--eval-days", default="2026-09-16,2026-09-17", help="Comma-separated local dates.")
    parser.add_argument("--output-dir", default="reports")
    parser.add_argument("--n-estimators", type=int, default=700)
    parser.add_argument("--max-depth", type=int, default=3)
    parser.add_argument("--learning-rate", type=float, default=0.035)
    parser.add_argument("--subsample", type=float, default=0.9)
    parser.add_argument("--colsample-bytree", type=float, default=0.85)
    return parser.parse_args()


def api_json(base_url: str, path: str, token: str | None = None, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    url = base_url.rstrip("/") + path
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=data, method=method, headers=headers)
    with urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def login(base_url: str, username: str, password_env: str, token_env: str) -> str:
    token = os.getenv(token_env)
    if token:
        return token
    password = os.getenv(password_env)
    if not password:
        password = getpass.getpass(f"Password API para {username}: ")
    result = api_json(base_url, "/auth/login", method="POST", body={"username": username, "password": password})
    token = result.get("token")
    if not token:
        raise RuntimeError("Login sin token en la respuesta.")
    return token


def fetch_dataset(base_url: str, token: str, fecha_desde: str, fecha_hasta: str) -> pd.DataFrame:
    params = urlencode({"fechaDesde": fecha_desde, "fechaHasta": fecha_hasta})
    result = api_json(base_url, f"/mercado/dataset?{params}", token=token)
    rows = result.get("rows") or []
    if not rows:
        raise RuntimeError("El endpoint /mercado/dataset no devolvio filas.")
    df = pd.DataFrame(rows)
    df["date"] = df["date"].astype(str)
    df["timestampUtc"] = df["timestampUtc"].astype(str)
    df["datetimeLocal"] = df["datetimeLocal"].astype(str)
    for col in [
        "precioOmie",
        "demandaPrevista",
        "eolica",
        "solarPrevista",
        "fotovoltaica",
        "termosolar",
        "nuclear",
        "nuclearDisponibleMw",
        "hidraulicaStorageIndex",
        "hidraulicaUGH",
        "hidraulicaNoUGH",
        "bombeo",
        "intercambios",
        "hour",
        "month",
        "weekday",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["isWeekend"] = df.get("isWeekend", False).astype(bool)
    return df.sort_values("timestampUtc").reset_index(drop=True)


def fetch_gas_prices(base_url: str, token: str, fecha_desde: str, fecha_hasta: str) -> dict[str, float]:
    params = urlencode(
        {
            "product": "GDAES_D+1",
            "placeOfDelivery": "PVB",
            "area": "ES",
            "firstDayDelivery": fecha_desde,
            "lastDayDelivery": fecha_hasta,
        }
    )
    try:
        result = api_json(base_url, f"/gas/mibgas/history?{params}", token=token)
    except Exception as exc:
        print(f"AVISO: no pude cargar MIBGAS por API ({exc}). Sigo sin precioGasMibgas.", file=sys.stderr)
        return {}
    prices: dict[str, float] = {}
    for row in result.get("rows") or []:
        date = str(row.get("firstDayDelivery", ""))[:10]
        value = row.get("priceEurMwh")
        if date and value is not None:
            prices[date] = float(value)
    return prices


def round6(value: float) -> float:
    if value is None or not math.isfinite(value):
        return np.nan
    return round(value, 6)


def ratio_pct(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    result = (numerator / denominator) * 100.0
    return result.replace([np.inf, -np.inf], np.nan)


def positive_gap(value: pd.Series, threshold: float, divisor: float = 1.0) -> pd.Series:
    return ((threshold - value).clip(lower=0.0) / divisor).where(value.notna())


def positive_excess(value: pd.Series, threshold: float) -> pd.Series:
    return (value - threshold).clip(lower=0.0).where(value.notna())


def add_features(df: pd.DataFrame, gas_prices: dict[str, float]) -> pd.DataFrame:
    out = df.copy()
    if "solarPrevista" not in out.columns:
        out["solarPrevista"] = np.nan
    fallback_solar = out.get("fotovoltaica", np.nan).fillna(0.0) + out.get("termosolar", np.nan).fillna(0.0)
    out["solarD1"] = out["solarPrevista"].where(out["solarPrevista"].notna(), fallback_solar)
    out["festivoNacional"] = 0
    out["isWeekend"] = out["isWeekend"].astype(int)
    out["precioGasMibgas"] = out["date"].map(gas_prices)

    out["demandaResidual"] = out["demandaPrevista"] - out["eolica"] - out["solarD1"]
    out["huecoTermicoD1"] = out["demandaPrevista"] - out["eolica"] - out["solarD1"] - out["nuclearDisponibleMw"]
    out["eolicaSobreDemandaPct"] = ratio_pct(out["eolica"], out["demandaPrevista"])
    out["solarSobreDemandaPct"] = ratio_pct(out["solarD1"], out["demandaPrevista"])
    out["nuclearDisponibleSobreDemandaPct"] = ratio_pct(out["nuclearDisponibleMw"], out["demandaPrevista"])
    out["nuclearPressureLow"] = positive_gap(out["nuclearDisponibleMw"], NUCLEAR_AVAILABLE_LOW_THRESHOLD_MW, 100.0)
    out["hidraulicaStoragePctOfMax"] = ratio_pct(out["hidraulicaStorageIndex"], pd.Series(HYDRAULIC_STORAGE_HIGH_REFERENCE, index=out.index))
    out["hidraulicaStorageLow"] = positive_gap(out["hidraulicaStorageIndex"], HYDRAULIC_STORAGE_LOW_THRESHOLD, 1_000_000.0)
    out["solarResidualDemandLow"] = np.where(
        out["solarSobreDemandaPct"] >= 25.0,
        positive_gap(out["demandaResidual"], 12_000.0, 1_000.0),
        0.0,
    )
    out["windPressurePct"] = out["eolicaSobreDemandaPct"]
    out["solarPressureHigh"] = positive_excess(out["solarSobreDemandaPct"], 55.0)

    solar_max = out.groupby("date")["solarD1"].transform("max")
    out["solarPctOfDailyMax"] = ratio_pct(out["solarD1"], solar_max)
    out["solarDropFromDailyMax"] = solar_max - out["solarD1"]

    price_by_day_hour = out.set_index(["date", "hour"])["precioOmie"].to_dict()
    lag24 = []
    lag48 = []
    for _, row in out.iterrows():
        day = datetime.strptime(row["date"], "%Y-%m-%d")
        hour = int(row["hour"])
        lag24.append(price_by_day_hour.get(((day - timedelta(days=1)).strftime("%Y-%m-%d"), hour), np.nan))
        lag48.append(price_by_day_hour.get(((day - timedelta(days=2)).strftime("%Y-%m-%d"), hour), np.nan))
    out["precioOmieLag24"] = lag24
    out["precioOmieLag48"] = lag48
    night = (out["hour"] <= 8) | (out["hour"] >= 20)
    out["precioOmieLag24Night"] = out["precioOmieLag24"].where(night, 0.0)
    out["precioOmieLag48Night"] = out["precioOmieLag48"].where(night, 0.0)

    out["rampaDemanda"] = out["demandaPrevista"].diff()
    out["rampaEolica"] = out["eolica"].diff()
    out["rampaSolar"] = out["solarD1"].diff()
    out["rampaHuecoTermicoD1"] = out["huecoTermicoD1"].diff()
    evening = (out["hour"] >= 17) & (out["hour"] <= 21)
    out["eveningThermalGapPressure"] = out["huecoTermicoD1"].where(evening, 0.0)
    out["eveningSolarExitThermalGap"] = (out["huecoTermicoD1"] * out["solarDropFromDailyMax"]).where(evening, 0.0)

    for season in ["winter", "spring", "summer", "autumn"]:
        out[f"season_{season}"] = (out["season"] == season).astype(int)

    out["solarPrevista"] = out["solarD1"]
    return out


def metrics(frame: pd.DataFrame, pred_col: str) -> dict[str, float]:
    error = frame[pred_col] - frame["precioOmie"]
    return {
        "rows": int(frame.shape[0]),
        "MAE": float(error.abs().mean()),
        "Bias": float(error.mean()),
        "RMSE": float(np.sqrt((error**2).mean())),
    }


def train_model(train: pd.DataFrame, args: argparse.Namespace) -> XGBRegressor:
    return XGBRegressor(
        objective="reg:squarederror",
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        learning_rate=args.learning_rate,
        subsample=args.subsample,
        colsample_bytree=args.colsample_bytree,
        min_child_weight=8,
        reg_lambda=8.0,
        reg_alpha=0.15,
        random_state=42,
        n_jobs=max(1, os.cpu_count() or 1),
        tree_method="hist",
    ).fit(train[D1_FEATURES], train["precioOmie"])


def predict_active_model(base_url: str, token: str, day: str) -> pd.DataFrame | None:
    try:
        models = api_json(base_url, "/mercado/forecast/models", token=token).get("models") or []
        active = next((item for item in models if item.get("activo") is True), None)
        if not active:
            return None
        body = {"modeloId": active["id"], "fechaDesde": day, "fechaHasta": day}
        result = api_json(base_url, "/mercado/forecast/predict/range", token=token, method="POST", body=body)
        rows = (result.get("predicciones") or [{}])[0].get("prediccionesHorarias") or []
        frame = pd.DataFrame(rows)
        if frame.empty:
            return None
        frame = frame[["datetimeLocal", "precioPrevisto"]].rename(columns={"precioPrevisto": "activo"})
        frame["activeVersion"] = int(active.get("version", 0))
        return frame
    except Exception as exc:
        print(f"AVISO: no pude calcular el modelo activo por API ({exc}).", file=sys.stderr)
        return None


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    args = parse_args()
    eval_days = [day.strip() for day in args.eval_days.split(",") if day.strip()]
    if not eval_days:
        raise SystemExit("--eval-days no puede estar vacio.")
    fecha_hasta = max(eval_days)
    context_from = (datetime.strptime(args.train_from, "%Y-%m-%d") - timedelta(days=2)).strftime("%Y-%m-%d")

    token = login(args.base_url, args.username, args.password_env, args.token_env)
    dataset = fetch_dataset(args.base_url, token, context_from, fecha_hasta)
    gas_prices = fetch_gas_prices(args.base_url, token, context_from, fecha_hasta)
    enriched = add_features(dataset, gas_prices)

    train = enriched[(enriched["date"] >= args.train_from) & (enriched["date"] <= args.train_to) & enriched["precioOmie"].notna()].dropna(subset=D1_FEATURES)
    if len(train) < 500:
        raise RuntimeError(f"Entrenamiento demasiado pequeno tras limpiar features: {len(train)} filas.")
    model = train_model(train, args)

    output_dir = Path(args.output_dir)
    summary_rows: list[dict[str, Any]] = []
    print(f"Entrenamiento XGBoost: {len(train)} filas, {len(D1_FEATURES)} features")
    print(f"Gas MIBGAS cargado para {len(gas_prices)} dias")
    print()

    for day in eval_days:
        day_rows = enriched[(enriched["date"] == day) & enriched["precioOmie"].notna()].dropna(subset=D1_FEATURES).copy()
        if day_rows.empty:
            print(f"{day}: sin filas completas con OMIE real.")
            continue
        day_rows["xgboost"] = model.predict(day_rows[D1_FEATURES])
        active = predict_active_model(args.base_url, token, day)
        if active is not None:
            day_rows = day_rows.merge(active, on="datetimeLocal", how="left")
        day_rows["hora"] = day_rows["datetimeLocal"].str.slice(11, 16)
        day_rows["errorXgb"] = day_rows["xgboost"] - day_rows["precioOmie"]
        detail_cols = ["hora", "xgboost", "precioOmie", "errorXgb"]
        if "activo" in day_rows.columns:
            day_rows["errorActivo"] = day_rows["activo"] - day_rows["precioOmie"]
            detail_cols.extend(["activo", "errorActivo"])

        xgb_metrics = metrics(day_rows, "xgboost")
        summary_rows.append({"fecha": day, "modelo": "xgboost", **{key: round6(value) for key, value in xgb_metrics.items()}})
        if "activo" in day_rows.columns and day_rows["activo"].notna().any():
            active_rows = day_rows.dropna(subset=["activo"])
            active_metrics = metrics(active_rows, "activo")
            version = int(active_rows["activeVersion"].dropna().iloc[0]) if "activeVersion" in active_rows and active_rows["activeVersion"].notna().any() else 0
            summary_rows.append({"fecha": day, "modelo": f"activo_v{version}", **{key: round6(value) for key, value in active_metrics.items()}})

        print(f"{day}")
        for row in summary_rows[-2:]:
            if row["fecha"] == day:
                print(f"  {row['modelo']}: rows={row['rows']} MAE={row['MAE']:.2f} Bias={row['Bias']:.2f} RMSE={row['RMSE']:.2f}")
        export = day_rows[detail_cols].round(4)
        print(export.to_string(index=False))
        print()
        write_csv(output_dir / f"mercado_xgboost_{day}.csv", export.to_dict("records"))

    write_csv(output_dir / "mercado_xgboost_summary.csv", summary_rows)
    print(f"CSV escritos en {output_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
