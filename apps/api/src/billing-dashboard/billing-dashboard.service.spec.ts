import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CmInvoiceConsumptionSource } from "@prisma/client";
import { inferSourceResolutionMinutes, normalizeGiscePriceList, normalizeMeasuresToQuarterHour, selectMeasureCandidate, type CurveIssue, type NormalizedMeasureCandidate } from "./billing-dashboard.service";

function candidate(consumption: number): NormalizedMeasureCandidate {
  return {
    raw: { id: consumption, datetime: "2026-08-01 00:00:00", ai: consumption },
    sourceId: consumption,
    sourceRawId: `raw-${consumption}`,
    sourceResolutionMinutes: 15,
    consumption
  };
}

describe("Billing dashboard curve source priority", () => {
  it("selects exactly one candidate with F1 > TgP1 > F5D > P5D", () => {
    assert.equal(selectMeasureCandidate(candidate(1), candidate(2), candidate(3), candidate(4)).source, CmInvoiceConsumptionSource.F1);
    assert.equal(selectMeasureCandidate(undefined, candidate(2), candidate(3), candidate(4)).source, CmInvoiceConsumptionSource.P1);
    assert.equal(selectMeasureCandidate(undefined, undefined, candidate(3), candidate(4)).source, CmInvoiceConsumptionSource.F5D);
    assert.equal(selectMeasureCandidate(undefined, undefined, undefined, candidate(4)).source, CmInvoiceConsumptionSource.P5D);
    assert.equal(selectMeasureCandidate(undefined, undefined, undefined, undefined).source, CmInvoiceConsumptionSource.MISSING);
  });
});

describe("Billing dashboard GISCE price list metadata", () => {
  it("imports price list id, name and one compatible invoicing mode", () => {
    const result = normalizeGiscePriceList({
      id: 4366,
      name: "PASS_THROUGH_RENOVACION",
      compatible_invoicing_modes: [{ id: 2, name: "Indexada" }]
    });
    assert.equal(result.priceListId, 4366);
    assert.equal(result.priceListName, "PASS_THROUGH_RENOVACION");
    assert.deepEqual(result.compatibleInvoicingModes, [{ externalId: 2, name: "Indexada" }]);
  });

  it("keeps several compatible modes and unknown names without hardcoded enum", () => {
    const result = normalizeGiscePriceList({
      id: 10,
      name: "LISTA_X",
      compatible_invoicing_modes: [{ id: 2, name: "Indexada" }, { id: 7, name: "ATR" }, { id: 99, name: "Modo futuro" }]
    });
    assert.deepEqual(result.compatibleInvoicingModes.map((mode) => mode.name), ["Indexada", "ATR", "Modo futuro"]);
  });

  it("supports empty arrays and null price list without fallbacks", () => {
    assert.deepEqual(normalizeGiscePriceList({ id: 1, name: "SIN_MODOS", compatible_invoicing_modes: [] }).compatibleInvoicingModes, []);
    assert.deepEqual(normalizeGiscePriceList(null), { priceListId: null, priceListName: null, compatibleInvoicingModes: [] });
  });
});

describe("Billing dashboard P5D normalization", () => {
  it("detects hourly P5D and splits each raw hour into four quarter-hours", () => {
    const rows = [
      { id: 1, name: "ES0022000008266290JP1P", datetime: "2026-08-01 01:00:00", ai: 40000 },
      { id: 2, name: "ES0022000008266290JP1P", datetime: "2026-08-01 02:00:00", ai: 20000 },
      { id: 3, name: "ES0022000008266290JP1P", datetime: "2026-08-01 03:00:00", ai: 12000 }
    ];
    const rawIds = new Map(rows.map((row) => [row.id, `raw-${row.id}`]));
    const issues: CurveIssue[] = [];
    const normalized = normalizeMeasuresToQuarterHour(rows, rawIds, "P5D", "DUPLICATE_P5D_INTERVAL", "invoice-1", issues, undefined, "INSTANT_START", 1000);
    const firstHour = [...normalized.values()].filter((item) => item.sourceRawId === "raw-1");

    assert.equal(inferSourceResolutionMinutes(rows), 60);
    assert.equal(normalized.size, 12);
    assert.equal(firstHour.length, 4);
    assert.equal(firstHour.reduce((sum, item) => sum + item.consumption, 0), 40);
    assert.deepEqual(firstHour.map((item) => item.consumption), [10, 10, 10, 10]);
    assert.equal(issues.length, 0);
  });

  it("keeps quarter-hour P5D as quarter-hour candidates", () => {
    const rows = [
      { id: 10, name: "ES0022000008266290JP1P", datetime: "2026-08-01 00:00:00", ai: 1000 },
      { id: 11, name: "ES0022000008266290JP1P", datetime: "2026-08-01 00:15:00", ai: 2000 },
      { id: 12, name: "ES0022000008266290JP1P", datetime: "2026-08-01 00:30:00", ai: 3000 },
      { id: 13, name: "ES0022000008266290JP1P", datetime: "2026-08-01 00:45:00", ai: 4000 }
    ];
    const rawIds = new Map(rows.map((row) => [row.id, `raw-${row.id}`]));
    const issues: CurveIssue[] = [];
    const normalized = normalizeMeasuresToQuarterHour(rows, rawIds, "P5D", "DUPLICATE_P5D_INTERVAL", "invoice-1", issues, undefined, "INSTANT_START", 1000);

    assert.equal(inferSourceResolutionMinutes(rows), 15);
    assert.equal(normalized.size, 4);
    assert.deepEqual([...normalized.values()].map((item) => item.consumption), [1, 2, 3, 4]);
    assert.deepEqual([...normalized.values()].map((item) => item.sourceResolutionMinutes), [15, 15, 15, 15]);
    assert.equal(issues.length, 0);
  });
});
