# energy_forecast internal service authentication

`energy_forecast` must use the application's existing authenticated internal
endpoints for ESIOS and OMIE downloads. It must not call external ESIOS or OMIE
APIs directly and must not bypass NestJS guards or middleware.

## Development

The sync command accepts an application auth token through either:

- `ENERGY_FORECAST_APP_AUTH_TOKEN`
- `python -m energy_forecast.data.sync --auth-token ...`

The backend URL is environment-specific and must come from:

- `BACKEND_BASE_URL`
- or `python -m energy_forecast.data.sync --api-base-url ...`

The token is only kept in memory for the current process. It must not be written
to reports, logs, exceptions, CSV files, or stdout.

If the internal API returns `401`, the sync command stops and records
`AUTH_REQUIRED`.

## Production recommendation

Use a service credential compatible with the existing application
authentication layer:

- run the first deployment with `ENERGY_FORECAST_ENV=prod` and
  `ENERGY_FORECAST_READ_ONLY=true`
- provide the production database through the existing `DATABASE_URL` secret
  (`PROD_DATABASE_URL` is accepted only as a compatibility fallback)
- set `BACKEND_BASE_URL` to the internal production API base URL before any
  controlled sync phase
- create a dedicated service principal or service user for scheduled forecast
  jobs
- issue a short-lived or rotatable application token with the minimum scope
  required to run internal download endpoints
- inject the token through the process supervisor or secret manager as
  `ENERGY_FORECAST_APP_AUTH_TOKEN`
- rotate the credential outside the repository
- keep audit logs tied to the service identity

Do not implement a special unauthenticated route for forecast sync and do not
store static tokens in the repository.
