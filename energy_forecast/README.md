# energy_forecast

Independent forecasting engine for OMIE Spain D+1 hourly prices, daily averages,
probabilistic ranges, and electricity market pressure indicators.

The module is intentionally decoupled from HTTP downloads. ESIOS data must come
from the existing application data layer through `EsiosAdapter.provider`.

## Main flow

1. Load already-downloaded ESIOS and OMIE series through `data/esios_adapter.py`.
2. Validate timezone, duplicate hours, hourly gaps, impossible negatives,
   outliers, availability, and leakage in `data/validation.py`.
3. Build electricity-system features in `features/electricity_features.py`.
4. Train baselines and tree boosting models through `models/`.
5. Backtest with walk-forward validation in `backtesting/walk_forward.py`.
6. Generate hourly quantiles, daily ranges, scenarios, `ccgt_marginality_index`,
   `omie_pressure_index`, explainability payloads, and append-only run records.

## Environment configuration

Use environment variables supplied by the process supervisor or secret manager.
Do not commit secrets or production-specific paths.

Required for the first production audit:

```text
ENERGY_FORECAST_ENV=prod
ENERGY_FORECAST_READ_ONLY=true
DATABASE_URL=<production PostgreSQL URL>
BACKEND_BASE_URL=<internal application base URL>
ENERGY_FORECAST_APP_AUTH_TOKEN=<service token, only for a later controlled sync>
```

`PROD_DATABASE_URL` is accepted as a compatibility fallback, but `DATABASE_URL`
is the preferred database configuration because it matches the rest of the
project.

## Production rollout order

1. Run `python -m pytest energy_forecast/tests`.
2. Run `python -m compileall energy_forecast`.
3. Deploy only the code and config files listed by source control; do not deploy
   generated `__pycache__`, local reports, or secrets.
4. Run the first production command in read-only mode:

```bash
python -m energy_forecast.data.audit --from 2025-01-01 --to <ultimo_dato>
```

In `ENERGY_FORECAST_ENV=prod`, the command writes:

- `reports/prod_data_coverage.csv`
- `reports/prod_data_sync_plan.csv`

It only reads the database and writes local reports. With
`ENERGY_FORECAST_READ_ONLY=true`, downloads, sync, inserts, updates, deletes, and
forecast persistence are blocked.

Review those reports before running any real sync. A controlled sync must target
only incomplete ESIOS indicators and should not re-download complete histories.

## Rollback

The Python module is decoupled from NestJS, Prisma, OMIE ingestion, and the
existing ESIOS ingestion. To remove it from a deployment, delete the
`energy_forecast/` package and any generated `reports/prod_*` forecast reports.
Do not change `apps/api`, `apps/web`, `apps/api/prisma/schema.prisma`, OMIE
tables, or ESIOS tables as part of this rollback.

## Excel input

Manual `.xlsx` files can be previewed and loaded without code changes through
`data/excel_adapter.py`. Column names are matched against
`config/column_aliases.yaml`, including loose matches such as `precio_omie`,
`Precio mercado diario`, `demanda_prevista`, `prevision_eolica`, `wind_forecast`,
and similar variants.

The preview reports detected sheets, detected/recognized/unrecognized columns,
time range, inferred frequency, duplicate timestamps, hourly gaps, timezone, row
count, and inferred units. Loading produces canonical long rows:

```text
timestamp | forecast_origin | available_at | variable | value | unit | source | status | data_type
```

`data_type` is explicit: `observed` data is never substituted for historical
`forecast` data. Forecast-looking Excel columns default to available at D-1
13:00 for D+1 hourly backtests; observed columns default to available at their
own timestamp.

## Backtesting

Run a D+1 OMIE walk-forward backtest from an Excel input:

```bash
python -m energy_forecast.backtesting.run --from 2025-01-01 --to 2026-08-31 --forecast-hour 13:00 --input path/to/input.xlsx
```

Before each simulated forecast origin, the runner validates that every predictor
row used satisfies `available_at <= forecast_origin`. Availability leakage raises
`DataValidationError` and stops the backtest.

Daily quantiles currently use:

```text
daily_quantile_method = hourly_quantile_average_proxy
```

This is intentionally documented as a proxy until joint hourly scenario
simulation is added.

## Critical modelling notes

- `residual_load = demand - wind - solar - hydro - nuclear - net_imports`.
- ESIOS import/export sign must be confirmed before mapping production
  interconnection variables. Alternative residual-load definitions are generated
  for backtesting comparisons.
- Historical real CCGT can be used for learning comparable historical states,
  but future real CCGT is excluded from prediction features.
- CCGT marginality v1 uses a proxy target and exposes `target_type = proxy`;
  it must not be presented as observed marginal technology.
- Missing external components in `omie_pressure_index` are not scored as zero;
  weights are re-scaled over available components.

## Optional dependencies

- `pandas` is required.
- `scikit-learn` is required for the fallback gradient boosting model.
- `lightgbm` is preferred when available.
- `shap` is optional for tree explainability.
