CREATE TABLE IF NOT EXISTS forecast_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  forecast_origin TIMESTAMPTZ NOT NULL,
  target_date DATE NOT NULL,
  model_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  forecast_p10 NUMERIC(20,6),
  forecast_p25 NUMERIC(20,6),
  forecast_p50 NUMERIC(20,6),
  forecast_p75 NUMERIC(20,6),
  forecast_p90 NUMERIC(20,6),
  actual_omie NUMERIC(20,6),
  ccgt_marginality_index NUMERIC(10,4),
  omie_pressure_index NUMERIC(10,4)
);

CREATE UNIQUE INDEX IF NOT EXISTS forecast_runs_run_hour_idx ON forecast_runs(run_id, target_date, hour);
CREATE INDEX IF NOT EXISTS forecast_runs_run_id_idx ON forecast_runs(run_id);
CREATE INDEX IF NOT EXISTS forecast_runs_target_date_idx ON forecast_runs(target_date);
CREATE INDEX IF NOT EXISTS forecast_runs_created_at_idx ON forecast_runs(created_at);
CREATE INDEX IF NOT EXISTS forecast_runs_model_version_idx ON forecast_runs(model_version);

CREATE TABLE IF NOT EXISTS forecast_inputs_snapshot (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_timestamp TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS forecast_inputs_snapshot_run_id_idx ON forecast_inputs_snapshot(run_id);
