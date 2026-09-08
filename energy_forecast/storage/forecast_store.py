from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pandas as pd

from energy_forecast.data.runtime import assert_write_allowed


@dataclass
class ForecastStore:
    connection: Any

    def save_run(
        self,
        *,
        forecast_origin: pd.Timestamp,
        target_date: str,
        model_version: str,
        dataset_version: str,
        feature_version: str,
        hourly: pd.DataFrame,
        input_snapshot: pd.DataFrame,
    ) -> str:
        assert_write_allowed("persist_forecast")
        run_id = str(uuid4())
        rows = []
        for timestamp, row in hourly.iterrows():
            rows.append(
                {
                    "run_id": run_id,
                    "forecast_origin": forecast_origin,
                    "target_date": target_date,
                    "model_version": model_version,
                    "dataset_version": dataset_version,
                    "feature_version": feature_version,
                    "hour": int(timestamp.hour),
                    "forecast_p10": row.get("p10"),
                    "forecast_p25": row.get("p25"),
                    "forecast_p50": row.get("p50"),
                    "forecast_p75": row.get("p75"),
                    "forecast_p90": row.get("p90"),
                    "actual_omie": row.get("actual_omie"),
                    "ccgt_marginality_index": row.get("ccgt_marginality_index"),
                    "omie_pressure_index": row.get("omie_pressure_index"),
                }
            )
        with self.connection.begin() as transaction:
            pd.DataFrame(rows).to_sql("forecast_runs", transaction, if_exists="append", index=False)
            snapshot = input_snapshot.reset_index().rename(columns={"index": "input_timestamp"})
            snapshot["run_id"] = run_id
            snapshot["payload"] = snapshot.drop(columns=["run_id", "input_timestamp"]).to_dict(orient="records")
            snapshot[["run_id", "input_timestamp", "payload"]].to_sql("forecast_inputs_snapshot", transaction, if_exists="append", index=False)
        return run_id
