import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CmInvoiceConsumptionSource, CmInvoiceCostRunStatus, CmInvoiceMarginStatus } from "@prisma/client";
import { BillingDashboardService, buildOperationalBalanceReport, inferSourceResolutionMinutes, normalizeGiscePriceList, normalizeMeasuresToQuarterHour, selectMeasureCandidate, type CurveIssue, type NormalizedMeasureCandidate } from "./billing-dashboard.service";

function candidate(consumption: number): NormalizedMeasureCandidate {
  return {
    raw: { id: consumption, datetime: "2026-08-01 00:00:00", ai: consumption },
    sourceId: consumption,
    sourceRawId: `raw-${consumption}`,
    sourceResolutionMinutes: 15,
    consumption
  };
}

function line(accountName: string, lineName: string, quantity: number, priceSubtotal: number) {
  return { accountName, lineName, quantity, priceUnit: 1, priceSubtotal };
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

describe("Billing dashboard operational balance", () => {
  it("passes CUPS, tariff and invoicing mode filters to the server-side query", async () => {
    let capturedWhere: unknown = null;
    const prisma = {
      cmInvoice: {
        findMany: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return [];
        }
      },
      $queryRaw: async () => []
    };
    const service = new BillingDashboardService(prisma as never, null as never, null as never, null as never, null as never);

    await service.operationalBalance(2026, { cups: "ES0022", tariff: "3.0TD", invoicingMode: "Indexada" });

    assert.deepEqual(capturedWhere, {
      invoiceDate: { gte: new Date(Date.UTC(2026, 0, 1)), lte: new Date(Date.UTC(2026, 11, 31)) },
      cups: { contains: "ES0022", mode: "insensitive" },
      tariffCode: { equals: "3.0TD", mode: "insensitive" },
      compatibleInvoicingModes: { some: { name: { equals: "Indexada", mode: "insensitive" } } }
    });
  });

  it("groups invoices by invoice date, not consumption period, and keeps billing concept breakdown", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [
        {
          id: "invoice-july",
          invoiceDate: new Date(Date.UTC(2026, 6, 5)),
          billedEnergyKwh: 100,
          lines: [
            line("Tarifas Acceso / Energia", "P1", 100, 50),
            line("Tarifas Acceso / Potencia", "P1", 180, 20),
            line("Otros", "Deposito de garantia", 1, -5)
          ]
        }
      ],
      curveTotals: [{ invoiceId: "invoice-july", _sum: { consumptionPfKwh: 101, consumptionBcKwh: 112 } }],
      costRuns: [],
      margins: [],
      intervalComponentSums: [],
      powerComponentSums: []
    });
    const billing = report.rows.find((row) => row.key === "billing")!;
    const invoiceCount = report.rows.find((row) => row.key === "invoice-count")!;
    const billedPf = report.rows.find((row) => row.key === "billed-pf")!;
    const calculatedPf = report.rows.find((row) => row.key === "calculated-pf")!;
    const calculatedBc = report.rows.find((row) => row.key === "calculated-bc")!;

    assert.equal(report.rows[0].key, "invoice-count");
    assert.equal(invoiceCount.months[6].value, 1);
    assert.equal(invoiceCount.total.value, 1);
    assert.equal(billing.months[6].value, 65);
    assert.equal(billing.total.value, 65);
    assert.equal(billing.children?.find((row) => row.label === "Energia")?.months[6].value, 50);
    assert.equal(billing.children?.find((row) => row.label === "Deposito de garantia")?.months[6].value, -5);
    assert.equal(billedPf.months[6].value, 100);
    assert.equal(calculatedPf.months[6].value, 101);
    assert.equal(calculatedBc.months[6].value, 112);
    assert.equal(billing.months[5].value, 0);
  });

  it("uses margin mappings for used revenue and persisted snapshots for margin", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-1",
        invoiceDate: new Date(Date.UTC(2026, 0, 15)),
        lines: [
          line("Tarifas Acceso / Energia", "P1", 100, 70),
          line("Tarifas Acceso / Potencia", "P1", 30, 20),
          line("Ajuste", "Ajuste por Costes del Sistema de Red Eléctrica de España", 1, 8),
          line("Alquiler", "ALQ Equipo Medida", 1, 3)
        ]
      }],
      curveTotals: [{ invoiceId: "invoice-1", _sum: { consumptionPfKwh: 1000, consumptionBcKwh: 1100 } }],
      costRuns: [{ id: "run-1", invoiceId: "invoice-1", incidentsCount: 0, status: CmInvoiceCostRunStatus.COMPLETED }],
      margins: [{ invoiceId: "invoice-1", costRunId: "run-1", marginStatus: CmInvoiceMarginStatus.READY, marginEur: 11 }],
      intervalComponentSums: [],
      powerComponentSums: []
    });
    const revenue = report.rows.find((row) => row.key === "used-revenue")!;
    const revenueEurMwh = report.rows.find((row) => row.key === "used-revenue-eur-mwh")!;
    const margin = report.rows.find((row) => row.key === "margin")!;
    const marginEurMwh = report.rows.find((row) => row.key === "margin-eur-mwh")!;

    assert.equal(revenue.months[0].value, 98);
    assert.equal(revenue.children?.find((row) => row.key === "used-revenue:energy")?.months[0].value, 78);
    assert.equal(revenue.children?.find((row) => row.key === "used-revenue:power")?.months[0].value, 20);
    assert.equal(revenueEurMwh.months[0].value, 98);
    assert.equal(revenueEurMwh.children?.find((row) => row.key === "used-revenue-eur-mwh:energy")?.months[0].value, 78);
    assert.equal(revenueEurMwh.children?.find((row) => row.key === "used-revenue-eur-mwh:power")?.months[0].value, 20);
    assert.equal(margin.months[0].value, 11);
    assert.equal(marginEurMwh.months[0].value, 11);
  });

  it("aggregates costs by nature and component without double-counting invoice lines", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-1",
        invoiceDate: new Date(Date.UTC(2026, 1, 1)),
        lines: [
          line("Tarifas Acceso / Energia", "P1", 1, 100),
          line("Tarifas Acceso / Energia", "P2", 1, 200),
          line("Tarifas Acceso / Potencia", "P1", 1, 50)
        ]
      }],
      curveTotals: [{ invoiceId: "invoice-1", _sum: { consumptionPfKwh: 2000, consumptionBcKwh: 2100 } }],
      costRuns: [{ id: "run-1", invoiceId: "invoice-1", incidentsCount: 1, status: CmInvoiceCostRunStatus.WARNING }],
      margins: [{ invoiceId: "invoice-1", costRunId: "run-1", marginStatus: CmInvoiceMarginStatus.WARNING, marginEur: 25 }],
      intervalComponentSums: [
        { costRunId: "run-1", componentCode: "OMIE_MD", costEur: 10 },
        { costRunId: "run-1", componentCode: "CAD", costEur: 4 },
        { costRunId: "run-1", componentCode: "IMU", costEur: 1 }
      ],
      powerComponentSums: [{ costRunId: "run-1", componentCode: "TOLLS_CHARGES_POWER", _sum: { costEur: 6 } }]
    });
    const costs = report.rows.find((row) => row.key === "costs")!;
    const costsEurMwh = report.rows.find((row) => row.key === "costs-eur-mwh")!;
    const energy = costs.children?.find((row) => row.key === "costs:energy")!;
    const power = costs.children?.find((row) => row.key === "costs:power")!;
    const energyEurMwh = costsEurMwh.children?.find((row) => row.key === "costs-eur-mwh:energy")!;
    const powerEurMwh = costsEurMwh.children?.find((row) => row.key === "costs-eur-mwh:power")!;
    const margin = report.rows.find((row) => row.key === "margin")!;

    assert.equal(costs.months[1].value, 21);
    assert.equal(energy.months[1].value, 15);
    assert.equal(power.months[1].value, 6);
    assert.equal(costsEurMwh.months[1].value, 10.5);
    assert.equal(energyEurMwh.months[1].value, 7.5);
    assert.equal(powerEurMwh.months[1].value, 3);
    assert.equal(energyEurMwh.children?.find((row) => row.key === "costs-eur-mwh:energy:OMIE_MD")?.months[1].value, 5);
    assert.equal(energy.children?.find((row) => row.key === "costs:energy:OMIE_MD")?.months[1].value, 10);
    assert.equal(power.children?.find((row) => row.key === "costs:power:TOLLS_CHARGES_POWER")?.months[1].value, 6);
    assert.equal(margin.months[1].warningInvoiceCount, 1);
    assert.equal(costs.months[1].warningInvoiceCount, 1);
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
