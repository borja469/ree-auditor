from __future__ import annotations

import math

import pandas as pd


def build_electricity_features(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy().sort_index()
    demand = first_present(result, ["demand_forecast", "demand", "demanda_prevista", "demanda_programada", "demanda_real"])
    wind = first_present(result, ["wind_forecast", "wind", "prevision_eolica", "generacion_eolica"])
    solar = first_present(result, ["solar_forecast", "solar", "prevision_solar", "generacion_solar_fotovoltaica"])
    hydro = first_present(result, ["hydro", "hidraulica"])
    nuclear = first_present(result, ["nuclear"])
    imports = first_present(result, ["net_imports", "total_net_import", "saldo_interconexiones"])

    # net_imports is positive when Spain imports energy and negative when it exports.
    # Positive imports reduce residual load; exports increase it through the negative sign.
    result["rl1_demand_wind_solar"] = demand - wind - solar
    result["rl2_demand_wind_solar_nuclear"] = result["rl1_demand_wind_solar"] - nuclear
    result["rl3_demand_wind_solar_nuclear_hydro"] = result["rl2_demand_wind_solar_nuclear"] - hydro
    result["rl4_demand_wind_solar_nuclear_hydro_netimports"] = result["rl3_demand_wind_solar_nuclear_hydro"] - imports
    result["residual_load"] = result["rl4_demand_wind_solar_nuclear_hydro_netimports"]
    result["residual_load_forecast"] = result["residual_load"]
    result["residual_load_alt_without_imports"] = demand - wind - solar - hydro - nuclear
    result["residual_load_alt_renewables_only"] = demand - wind - solar
    result["residual_load_pct"] = safe_ratio(result["residual_load"], demand)
    result["residual_load_change_1h"] = result["residual_load"].diff(1)
    result["residual_load_change_24h"] = result["residual_load"].diff(24)
    result["residual_load_rolling_3h"] = result["residual_load"].rolling(3, min_periods=1).mean()
    result["residual_load_rolling_6h"] = result["residual_load"].rolling(6, min_periods=1).mean()

    result["demand_forecast"] = demand
    add_lags(result, "demand", demand, [24, 48, 168])
    result["demand_same_hour_previous_day"] = demand.shift(24)
    result["demand_same_hour_previous_week"] = demand.shift(168)

    result["wind_forecast"] = wind
    result["wind_share"] = safe_ratio(wind, demand)
    result["wind_lag_24h"] = wind.shift(24)
    result["wind_forecast_change"] = wind.diff(1)
    if "generacion_eolica" in result.columns and "prevision_eolica" in result.columns:
        result["wind_forecast_error"] = result["generacion_eolica"] - result["prevision_eolica"]

    result["solar_forecast"] = solar
    result["solar_share"] = safe_ratio(solar, demand)
    result["daylight_hour"] = result.index.hour.map(lambda hour: 1 if 7 <= hour <= 20 else 0)
    result["sunrise_proxy"] = result.index.month.map(lambda month: 8 if month in [11, 12, 1, 2] else 7 if month in [3, 4, 9, 10] else 6)
    result["sunset_proxy"] = result.index.month.map(lambda month: 18 if month in [11, 12, 1, 2] else 20 if month in [3, 4, 9, 10] else 21)
    result["solar_lag_24h"] = solar.shift(24)

    result["hydro_generation"] = hydro
    result["hydro_lag_24h"] = hydro.shift(24)
    result["hydro_rolling_7d"] = hydro.rolling(24 * 7, min_periods=24).mean()
    result["hydro_share"] = safe_ratio(hydro, demand)

    result["nuclear_generation"] = nuclear
    result["nuclear_available_capacity"] = result.get("nuclear_available_capacity", nuclear)
    result["nuclear_lag_24h"] = nuclear.shift(24)
    result["nuclear_delta"] = nuclear.diff(1)

    result["france_net_import"] = result.get("france_net_import")
    result["portugal_net_import"] = result.get("portugal_net_import")
    result["net_imports"] = imports
    result["total_net_import"] = imports
    result["interconnection_lag_24h"] = imports.shift(24)
    result["solar_expected"] = expected_series(result, ["solar_forecast", "prevision_solar"], solar)
    result["nuclear_expected"] = expected_series(result, ["nuclear_expected", "nuclear_available_capacity"], nuclear)
    result["hydro_expected"] = expected_series(result, ["hydro_expected"], hydro)
    result["net_import_expected"] = expected_series(result, ["net_import_expected"], imports)
    result["forecastable_residual_load"] = (
        demand - wind - result["solar_expected"] - result["nuclear_expected"] - result["hydro_expected"] - result["net_import_expected"]
    )
    result["forecastable_residual_load_version"] = "v1_proxy_lag24_lag168_rolling"
    result["solar_forecast_source"] = "proxy" if "solar_forecast" not in result.columns and "prevision_solar" not in result.columns else "source"
    result["forecastable_residual_load_components_available"] = (
        demand.notna()
        & wind.notna()
        & result["solar_expected"].notna()
        & result["nuclear_expected"].notna()
        & result["hydro_expected"].notna()
        & result["net_import_expected"].notna()
    ).astype(int)

    ccgt = first_present(result, ["ciclos_combinados"])
    result["ccgt_generation"] = ccgt
    result["ccgt_share"] = safe_ratio(ccgt, demand)
    result["ccgt_lag_24h"] = ccgt.shift(24)

    add_calendar_features(result)
    if "omie_price" in result.columns:
        add_price_features(result)
    return result


def first_present(df: pd.DataFrame, columns: list[str]) -> pd.Series:
    values = pd.Series(index=df.index, dtype="float64")
    for column in columns:
        if column in df.columns:
            values = values.fillna(pd.to_numeric(df[column], errors="coerce"))
    return values


def add_lags(df: pd.DataFrame, prefix: str, series: pd.Series, lags: list[int]) -> None:
    for lag in lags:
        df[f"{prefix}_lag_{lag}h"] = series.shift(lag)


def expected_series(df: pd.DataFrame, forecast_columns: list[str], observed: pd.Series) -> pd.Series:
    forecast = first_present(df, forecast_columns)
    proxy = observed.shift(24).fillna(observed.shift(168)).fillna(observed.shift(24).rolling(24 * 7, min_periods=1).mean())
    return forecast.fillna(proxy)


def add_price_features(df: pd.DataFrame) -> None:
    price = pd.to_numeric(df["omie_price"], errors="coerce")
    df["omie_lag_24h"] = price.shift(24)
    df["omie_lag_48h"] = price.shift(48)
    df["omie_lag_168h"] = price.shift(168)
    df["omie_rolling_mean_24h"] = price.shift(24).rolling(24, min_periods=8).mean()
    df["omie_rolling_mean_7d"] = price.shift(24).rolling(24 * 7, min_periods=24).mean()
    df["omie_rolling_std_7d"] = price.shift(24).rolling(24 * 7, min_periods=24).std()
    previous_day = price.shift(24).groupby(price.index.date).transform
    df["previous_day_min"] = previous_day("min")
    df["previous_day_max"] = previous_day("max")
    df["previous_day_mean"] = previous_day("mean")


def add_calendar_features(df: pd.DataFrame) -> None:
    index = df.index
    df["hour"] = index.hour
    df["day_of_week"] = index.dayofweek
    df["month"] = index.month
    df["weekend"] = (index.dayofweek >= 5).astype(int)
    holidays = spanish_holiday_proxy(index)
    df["holiday_spain"] = holidays.astype(int)
    df["working_day"] = ((index.dayofweek < 5) & ~holidays).astype(int)
    df["bridge_day"] = 0
    df["sin_hour"] = index.hour.map(lambda hour: math.sin(2 * math.pi * hour / 24))
    df["cos_hour"] = index.hour.map(lambda hour: math.cos(2 * math.pi * hour / 24))
    day_of_year = index.dayofyear
    df["sin_day_of_year"] = day_of_year.map(lambda day: math.sin(2 * math.pi * day / 366))
    df["cos_day_of_year"] = day_of_year.map(lambda day: math.cos(2 * math.pi * day / 366))


def spanish_holiday_proxy(index: pd.DatetimeIndex) -> pd.Series:
    fixed = {(1, 1), (1, 6), (5, 1), (8, 15), (10, 12), (11, 1), (12, 6), (12, 8), (12, 25)}
    return pd.Series([(ts.month, ts.day) in fixed for ts in index], index=index)


def safe_ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator.div(denominator.where(denominator != 0))
