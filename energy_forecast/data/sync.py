from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from .audit import DEFAULT_DATABASE_URL
from .esios_download_gateway import DownloadRequest, ExistingEsiosDownloadGateway
from .omie_download_gateway import ExistingOmieDownloadGateway, OMIE_MD_CODE
from .requirements import DataRequirementsService
from .runtime import ReadOnlyViolation, assert_write_allowed, load_runtime_config


def main() -> int:
    runtime = load_runtime_config()
    parser = argparse.ArgumentParser(description="Audit and complete ESIOS histories required by energy_forecast.")
    parser.add_argument("--from", dest="from_date", required=True)
    parser.add_argument("--to", dest="to_date", required=True)
    parser.add_argument("--database-url", default=runtime.database_url or DEFAULT_DATABASE_URL)
    parser.add_argument("--api-base-url", default=runtime.backend_base_url)
    parser.add_argument("--auth-token", default=runtime.app_auth_token)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--coverage-output", default="reports/data_coverage.csv")
    parser.add_argument("--sync-output", default="reports/data_sync_plan.csv")
    args = parser.parse_args()

    if not args.database_url:
        print("DATABASE_URL_REQUIRED: sync needs DATABASE_URL, PROD_DATABASE_URL, or --database-url.")
        return 3

    service = DataRequirementsService(database_url=args.database_url)
    before = service.audit(args.from_date, args.to_date)
    before_by_variable = {str(row["variable"]): row for row in before}
    missing = service.get_missing_requirements(args.from_date, args.to_date)
    omie_plan = [
        DownloadRequest(str(item["variable"]), 0, str(item["missing_from"]), str(item["missing_to"]), str(item["priority"]))
        for item in missing
        if item.get("source") == "omie" and item.get("variable") == "omie_price" and item.get("missing_from") and item.get("missing_to")
    ]
    esios_plan = [
        DownloadRequest(str(item["variable"]), int(item["indicator_id"]), str(item["missing_from"]), str(item["missing_to"]), str(item["priority"]))
        for item in missing
        if item.get("source") == "esios" and item.get("indicator_id") and item.get("missing_from") and item.get("missing_to")
    ]
    plan = omie_plan + esios_plan

    print("DATA REQUIRED")
    for request_item in plan:
        source = "OMIE" if request_item.variable == "omie_price" else "ESIOS"
        indicator = OMIE_MD_CODE if request_item.variable == "omie_price" else request_item.indicator_id
        print(f"{request_item.variable:<24} {source} {indicator!s:<6} {request_item.from_date} -> {request_item.to_date} {request_item.priority}")

    results: list[dict[str, object]] = []
    if not args.dry_run and plan:
        if not args.api_base_url:
            print("BACKEND_BASE_URL_REQUIRED: sync needs BACKEND_BASE_URL or --api-base-url.")
            return 3
        try:
            assert_write_allowed("sync")
            assert_write_allowed("download")
        except ReadOnlyViolation as exc:
            print(str(exc))
            print("Sync blocked. Use --dry-run for a read-only sync plan.")
            return 5
        if omie_plan:
            omie_gateway = ExistingOmieDownloadGateway(api_base_url=args.api_base_url, auth_token=args.auth_token)
            for item in omie_plan:
                results.extend(omie_gateway.ensure_omie_history(item.from_date, item.to_date, database_url=args.database_url))
                if has_auth_required(results):
                    break
        if esios_plan and not has_auth_required(results):
            gateway = ExistingEsiosDownloadGateway(api_base_url=args.api_base_url, auth_token=args.auth_token)
            results.extend(gateway.ensure_indicator_history(esios_plan))

    auth_blocked = has_auth_required(results)
    after = before if args.dry_run or auth_blocked else service.audit(args.from_date, args.to_date)
    after_by_variable = {str(row["variable"]): row for row in after}
    write_coverage(args.coverage_output, after)
    write_sync_report(args.sync_output, before_by_variable, after_by_variable, plan, results, args.dry_run)
    readiness = service.readiness(after)

    print(f"Training readiness: {readiness.training_data_readiness}/100")
    print(f"D+1 readiness: {readiness.d1_forecast_readiness}/100")
    print(f"Coverage report written to {Path(args.coverage_output).resolve()}")
    print(f"Sync report written to {Path(args.sync_output).resolve()}")
    if args.dry_run:
        print("Dry-run only: no downloads requested.")
    if runtime.read_only:
        print("Read-only mode active: no downloads or writes were requested.")
    if auth_blocked:
        print("AUTH_REQUIRED: internal application authentication is required. No token was printed or persisted.")
        return 4
    return 0


def write_coverage(path: str, rows: list[dict[str, object]]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()) if rows else ["variable"])
        writer.writeheader()
        writer.writerows(rows)


def write_sync_report(
    path: str,
    before: dict[str, dict[str, object]],
    after: dict[str, dict[str, object]],
    plan: list[DownloadRequest],
    results: list[dict[str, object]],
    dry_run: bool,
) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    result_status: dict[tuple[str, str, str], list[dict[str, object]]] = {}
    for item in results:
        request_payload = item.get("request", {})
        if not isinstance(request_payload, dict):
            continue
        result_status.setdefault((str(request_payload.get("variable")), str(item.get("from")), str(item.get("to"))), []).append(item)
    rows = []
    for item in plan:
        matching = [
            result
            for (variable, start, end), values in result_status.items()
            if variable == item.variable and start >= item.from_date and end <= item.to_date
            for result in values
        ]
        source = "omie" if item.variable == "omie_price" else "esios"
        indicator = OMIE_MD_CODE if item.variable == "omie_price" else item.indicator_id
        status = sync_status(item.variable, before, after, matching, dry_run)
        rows.append(
            {
                "variable": item.variable,
                "source": source,
                "indicator_id": indicator,
                "coverage_before": before.get(item.variable, {}).get("coverage_pct"),
                "requested_from": item.from_date,
                "requested_to": item.to_date,
                "records_before": before.get(item.variable, {}).get("observations"),
                "records_after": after.get(item.variable, {}).get("observations"),
                "coverage_after": after.get(item.variable, {}).get("coverage_pct"),
                "status": status,
                "download_result": json.dumps(public_result(matching), ensure_ascii=False),
            }
        )
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(rows[0].keys())
            if rows
            else ["variable", "source", "indicator_id", "coverage_before", "requested_from", "requested_to", "records_before", "records_after", "coverage_after", "status"],
        )
        writer.writeheader()
        writer.writerows(rows)


def has_auth_required(results: list[dict[str, object]]) -> bool:
    return any(str(item.get("status")) == "AUTH_REQUIRED" for item in results)


def sync_status(
    variable: str,
    before: dict[str, dict[str, object]],
    after: dict[str, dict[str, object]],
    matching: list[dict[str, object]],
    dry_run: bool,
) -> str:
    if dry_run:
        return "DRY_RUN"
    statuses = {str(result.get("status")) for result in matching}
    if "AUTH_REQUIRED" in statuses:
        return "AUTH_REQUIRED"
    if "ERROR" in statuses:
        return "FAILED"
    before_records = int(before.get(variable, {}).get("observations") or 0)
    after_records = int(after.get(variable, {}).get("observations") or 0)
    if not matching:
        return "NOT_REQUESTED"
    if after_records <= before_records:
        return "NO_NEW_DATA"
    availability = str(after.get(variable, {}).get("availability_status") or "")
    if availability == "COMPLETE":
        return "DOWNLOADED"
    return "PARTIAL_AFTER_DOWNLOAD"


def public_result(results: list[dict[str, object]]) -> list[dict[str, object]]:
    public = []
    for item in results:
        public.append(
            {
                "from": item.get("from"),
                "to": item.get("to"),
                "status": item.get("status"),
                "error": item.get("error"),
            }
        )
    return public


if __name__ == "__main__":
    raise SystemExit(main())
