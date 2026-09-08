from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .contracts import MADRID_TZ
from .omie_frequency import aggregate_omie_periods_to_hourly


@dataclass
class SystemDatabaseProvider:
    """Provider for already-ingested system tables.

    The caller owns the DB connection. This keeps the forecast engine independent
    from NestJS and from any specific credential-loading policy.
    """

    connection: object
    indicator_mapping: dict[str, int]
    include_omie: bool = True

    def load_hourly_indicators(self, start, end, indicators=None) -> pd.DataFrame:
        selected = indicators or self.indicator_mapping
        esios = self._load_esios(start, end, selected)
        frames = [esios]
        if self.include_omie:
            frames.append(self._load_omie(start, end))
        frame = pd.concat(frames, axis=1).sort_index()
        frame = frame.loc[:, ~frame.columns.duplicated(keep="last")]
        return frame

    def _load_esios(self, start, end, selected: dict[str, int]) -> pd.DataFrame:
        ids = {name: indicator_id for name, indicator_id in selected.items() if indicator_id}
        if not ids:
            return pd.DataFrame()
        placeholders = ",".join(str(int(value)) for value in ids.values())
        sql = f"""
            select indicator_id, datetime, value::float as value
            from esios_indicator_values
            where indicator_id in ({placeholders})
              and datetime >= %(start)s
              and datetime <= %(end)s
        """
        raw = pd.read_sql_query(sql, self.connection, params={"start": start, "end": end})
        if raw.empty:
            return pd.DataFrame()
        reverse = {indicator_id: name for name, indicator_id in ids.items()}
        raw["variable"] = raw["indicator_id"].map(reverse)
        raw["timestamp"] = pd.to_datetime(raw["datetime"])
        frame = raw.pivot_table(index="timestamp", columns="variable", values="value", aggfunc="mean")
        frame.index = _localize_index(frame.index)
        return frame

    def _load_omie(self, start, end) -> pd.DataFrame:
        sql = """
            select fecha_programa, periodo, precio_eur_mwh::float as precio_eur_mwh
            from omie_prices
            where fecha_programa >= %(start)s::date
              and fecha_programa <= %(end)s::date
              and tipo_precio = 'MD'
            order by fecha_programa, periodo
        """
        raw = pd.read_sql_query(sql, self.connection, params={"start": start, "end": end})
        if raw.empty:
            return pd.DataFrame()
        frame, _metadata = aggregate_omie_periods_to_hourly(raw)
        return frame


def _localize_index(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    if index.tz is None:
        return index.tz_localize(MADRID_TZ, ambiguous="infer", nonexistent="shift_forward")
    return index.tz_convert(MADRID_TZ)
