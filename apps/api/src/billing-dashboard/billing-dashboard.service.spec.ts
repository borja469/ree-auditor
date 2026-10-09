import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CmInvoiceConsumptionSource, CmInvoiceCostRunStatus, CmInvoiceDocumentType, CmInvoiceMarginStatus, CmInvoiceProcessingStatus } from "@prisma/client";
import { BillingDashboardService, buildOperationalBalanceReport, inferSourceResolutionMinutes, marginConceptMapping, normalizeGiscePriceList, normalizeMeasuresToQuarterHour, selectMeasureCandidate, summarizeInvoiceLineConcepts, type CurveIssue, type NormalizedMeasureCandidate } from "./billing-dashboard.service";

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

describe("Billing dashboard revenue concept mapping", () => {
  it("clasifica conceptos comerciales adicionales como ingresos de energia", () => {
    const concepts = [
      "Repercusión de garantías de origen",
      "Coste Financiero [%]",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
      "Coste de Gestion 6,75 /mes",
      "Facturacion Complementaria imputada por parte de la Distribuidora - Energia",
      "Servei adicional \"Sostre de preu a 80 EUR/MWh\"",
      "Penalización por resolución anticipada de contrato",
      "Coste de Gestión 3,3 €/mes",
      "Coste de Gestión 6,75 €/mes",
      "Servicio adiciona \"Techo de precio a 80 €/MWh\"",
      "Servicio adicional \"Techo de precio a 80 €/MWh\"",
      "Facturación Complementaria imputad",
      "Facturación Complementaria imputada",
      "Garantías de Origen"
    ];

    for (const concept of concepts) assert.equal(marginConceptMapping(concept), "ENERGY", concept);
    assert.equal(marginConceptMapping("Ajust per Costos del Sistema de la Xarxa Elèctrica d'Espanya"), "ADJUSTMENT");
  });

  it("usa la cuenta como concepto cuando la linea viene periodificada como P1-P6", () => {
    const summary = summarizeInvoiceLineConcepts([
      { accountName: "Coste Financiero [%]", lineName: "P1", priceSubtotal: 4 },
      { accountName: "Coste Financiero [%]", lineName: "P2", priceSubtotal: 6 },
      { accountName: "Tarifas Acceso / Energia", lineName: "P3", priceSubtotal: 90 }
    ]);

    assert.equal(summary.hasMappedConcepts, true);
    assert.equal(summary.associatedRevenueEur, 100);
    assert.equal(summary.rows.find((row) => row.concept === "Coste Financiero [%]")?.amount, 10);
    assert.equal(summary.rows.find((row) => row.concept === "Energia")?.amount, 90);
  });

  it("reclasifica snapshots antiguos sin nature usando el mapeo actual", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-legacy",
        invoiceDate: new Date(Date.UTC(2026, 6, 1)),
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 100)]
      }],
      curveTotals: [{ invoiceId: "invoice-legacy", _sum: { consumptionPfKwh: 1000, consumptionBcKwh: 1100 } }],
      costRuns: [{ id: "run-legacy", invoiceId: "invoice-legacy", incidentsCount: 0, status: CmInvoiceCostRunStatus.COMPLETED }],
      margins: [{
        invoiceId: "invoice-legacy",
        costRunId: "run-legacy",
        marginStatus: CmInvoiceMarginStatus.READY,
        associatedRevenueEur: 120,
        associatedCostEur: 80,
        marginEur: 40,
        detailsJson: {
          costsByNature: { ENERGY: 80, POWER: 0 },
          rows: [
            { concept: "Garantias de Origen", amount: 10, nature: null },
            { concept: "Servicio adicional \"Techo de precio a 80 EUR/MWh\"", amount: 20, nature: null },
            { concept: "Facturacion Complementaria imputada por parte de la Distribuidora - Energia", amount: 30, nature: null },
            { concept: "P3", amount: 60, nature: null },
            { concept: "ALQ Equipo Medida", amount: 5, nature: null }
          ]
        }
      }],
      intervalComponentSums: [],
      powerComponentSums: []
    });

    const revenue = report.rows.find((row) => row.key === "used-revenue")!;
    const energyRevenue = revenue.children?.find((row) => row.key === "used-revenue:energy")!;
    const excludedRevenue = report.rows.find((row) => row.key === "excluded-revenue")!;
    assert.equal(revenue.months[6].value, 120);
    assert.equal(energyRevenue.months[6].value, 120);
    assert.equal(excludedRevenue.months[6].value, 5);
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
      cmInvoiceConsumptionCurve: { groupBy: async () => [] },
      cmInvoiceCostRun: { findMany: async () => [] },
      cmInvoiceMarginSnapshot: { findMany: async () => [] },
      $queryRaw: async () => []
    };
    const service = new BillingDashboardService(prisma as never, null as never, null as never, null as never, null as never);

    await (service as never as { calculateOperationalBalance: (year: number, filters: { cups: string; tariff: string; invoicingMode: string }) => Promise<unknown> }).calculateOperationalBalance(2026, { cups: "ES0022", tariff: "3.0TD", invoicingMode: "Indexada" });

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

  it("resta abonos GISCE en facturacion y consumo economico sin tocar la cobertura fisica", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [
        {
          id: "invoice-credit-note",
          invoiceDate: new Date(Date.UTC(2026, 9, 5)),
          documentType: CmInvoiceDocumentType.CREDIT_NOTE,
          economicSign: -1,
          billedEnergyKwh: 1489,
          lines: [
            line("Tarifas Acceso / Energia", "P4", 497, 51.34),
            line("Tarifas Acceso / Energia", "P5", 360, 37.19),
            line("Tarifas Acceso / Energia", "P6", 632, 101.37),
            line("Tarifas Acceso / Potencia", "P1", 18.2, 122.29),
            line("Ventas de mercaderias en Espana", "Ajuste por Costes del Sistema de Red Electrica de Espana", 1489, 24.52)
          ]
        }
      ],
      curveTotals: [{ invoiceId: "invoice-credit-note", _sum: { consumptionPfKwh: 1489.000032, consumptionBcKwh: 1735.532072 } }],
      curveSourceTotals: [{ invoiceId: "invoice-credit-note", consumptionSource: CmInvoiceConsumptionSource.F1, _sum: { consumptionPfKwh: 1489.000032 } }],
      costRuns: [],
      margins: [],
      intervalComponentSums: [],
      powerComponentSums: []
    });
    const billing = report.rows.find((row) => row.key === "billing")!;
    const billedPf = report.rows.find((row) => row.key === "billed-pf")!;
    const calculatedPf = report.rows.find((row) => row.key === "calculated-pf")!;
    const calculatedBc = report.rows.find((row) => row.key === "calculated-bc")!;
    const sourceShare = report.rows.find((row) => row.key === "consumption-source-share")!;

    assert.equal(billing.months[9].value, -336.71);
    assert.equal(billedPf.months[9].value, -1489);
    assert.equal(calculatedPf.months[9].value, -1489.000032);
    assert.equal(calculatedBc.months[9].value, -1735.532072);
    assert.equal(sourceShare.children?.find((row) => row.key === "consumption-source-share:F1")?.months[9].value, 100);
  });

  it("adds invoice warning/error counts and PF consumption share by curve source", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-ok",
        invoiceDate: new Date(Date.UTC(2026, 8, 1)),
        processingStatus: CmInvoiceProcessingStatus.READY,
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 100)]
      }, {
        id: "invoice-warning",
        invoiceDate: new Date(Date.UTC(2026, 8, 2)),
        processingStatus: CmInvoiceProcessingStatus.WARNING,
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 200)]
      }, {
        id: "invoice-error",
        invoiceDate: new Date(Date.UTC(2026, 8, 3)),
        processingStatus: CmInvoiceProcessingStatus.ERROR,
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 300)]
      }],
      curveTotals: [],
      curveSourceTotals: [
        { invoiceId: "invoice-ok", consumptionSource: CmInvoiceConsumptionSource.F1, _sum: { consumptionPfKwh: 70 } },
        { invoiceId: "invoice-warning", consumptionSource: CmInvoiceConsumptionSource.P1, _sum: { consumptionPfKwh: 30 } }
      ],
      costRuns: [],
      margins: [],
      intervalComponentSums: [],
      powerComponentSums: []
    });
    const errors = report.rows.find((row) => row.key === "invoice-error-count")!;
    const warnings = report.rows.find((row) => row.key === "invoice-warning-count")!;
    const sourceShare = report.rows.find((row) => row.key === "consumption-source-share")!;

    assert.equal(errors.months[8].value, 1);
    assert.equal(warnings.months[8].value, 1);
    assert.equal(sourceShare.months[8].value, 100);
    assert.equal(sourceShare.children?.find((row) => row.key === "consumption-source-share:F1")?.months[8].value, 70);
    assert.equal(sourceShare.children?.find((row) => row.key === "consumption-source-share:P1")?.months[8].value, 30);
    assert.equal(sourceShare.children?.find((row) => row.key === "consumption-source-share:F1")?.total.value, 70);
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
      margins: [{
        invoiceId: "invoice-1",
        costRunId: "run-1",
        marginStatus: CmInvoiceMarginStatus.READY,
        associatedRevenueEur: 98,
        associatedCostEur: 87,
        marginEur: 11,
        detailsJson: {
          costsByNature: { ENERGY: 80, POWER: 7 },
          rows: [
            { concept: "Energia", amount: 70, nature: "ENERGY" },
            { concept: "Potencia", amount: 20, nature: "POWER" },
            { concept: "Ajuste por Costes del Sistema de Red Electrica de Espana", amount: 8, nature: "ENERGY" },
            { concept: "ALQ Equipo Medida", amount: 3, nature: null }
          ]
        }
      }],
      intervalComponentSums: [],
      powerComponentSums: []
    });
    const revenue = report.rows.find((row) => row.key === "used-revenue")!;
    const excludedRevenue = report.rows.find((row) => row.key === "excluded-revenue")!;
    const revenueEurMwh = report.rows.find((row) => row.key === "used-revenue-eur-mwh")!;
    const margin = report.rows.find((row) => row.key === "margin")!;
    const marginEurMwh = report.rows.find((row) => row.key === "margin-eur-mwh")!;
    const energyRevenue = revenue.children?.find((row) => row.key === "used-revenue:energy")!;

    assert.equal(revenue.months[0].value, 98);
    assert.equal(energyRevenue.months[0].value, 78);
    assert.equal(energyRevenue.children?.find((row) => row.label === "Energia")?.months[0].value, 70);
    assert.equal(energyRevenue.children?.find((row) => row.label === "Ajuste por Costes del Sistema de Red Electrica de Espana")?.months[0].value, 8);
    assert.equal(revenue.children?.find((row) => row.key === "used-revenue:power")?.months[0].value, 20);
    assert.equal(excludedRevenue.months[0].value, 3);
    assert.equal(excludedRevenue.children?.find((row) => row.label === "ALQ Equipo Medida")?.months[0].value, 3);
    assert.equal(revenueEurMwh.months[0].value, 98);
    assert.equal(revenueEurMwh.children?.find((row) => row.key === "used-revenue-eur-mwh:energy")?.months[0].value, 78);
    assert.equal(revenueEurMwh.children?.find((row) => row.key === "used-revenue-eur-mwh:power")?.months[0].value, 20);
    assert.equal(margin.months[0].value, 11);
    assert.equal(marginEurMwh.months[0].value, 11);
  });

  it("cuadra padres de ingresos y costes con sus partidas usando componentes del run para costes", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-1",
        invoiceDate: new Date(Date.UTC(2026, 0, 15)),
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 100)]
      }],
      curveTotals: [{ invoiceId: "invoice-1", _sum: { consumptionPfKwh: 1000, consumptionBcKwh: 1100 } }],
      costRuns: [{ id: "run-1", invoiceId: "invoice-1", incidentsCount: 0, status: CmInvoiceCostRunStatus.COMPLETED }],
      margins: [{
        invoiceId: "invoice-1",
        costRunId: "run-1",
        marginStatus: CmInvoiceMarginStatus.READY,
        associatedRevenueEur: 999,
        associatedCostEur: 888,
        marginEur: 11,
        detailsJson: {
          costsByNature: { ENERGY: 80, POWER: 7 },
          rows: [
            { concept: "Energia", amount: 70, nature: "ENERGY" },
            { concept: "Potencia", amount: 20, nature: "POWER" },
            { concept: "Ajuste por Costes del Sistema de Red Electrica de Espana", amount: 8, nature: "ENERGY" }
          ]
        }
      }],
      intervalComponentSums: [{ costRunId: "run-1", componentCode: "OMIE_MD", costEur: 100 }],
      powerComponentSums: [{ costRunId: "run-1", componentCode: "TOLLS_CHARGES_POWER", _sum: { costEur: 20 } }]
    });
    const revenue = report.rows.find((row) => row.key === "used-revenue")!;
    const costs = report.rows.find((row) => row.key === "costs")!;
    const margin = report.rows.find((row) => row.key === "margin")!;
    const revenueChildren = revenue.children?.reduce((sum, row) => sum + (row.months[0].value ?? 0), 0);
    const costChildren = costs.children?.reduce((sum, row) => sum + (row.months[0].value ?? 0), 0);

    assert.equal(revenue.months[0].value, 98);
    assert.equal(revenue.months[0].value, revenueChildren);
    assert.equal(costs.months[0].value, 120);
    assert.equal(costs.months[0].value, costChildren);
    assert.equal(margin.months[0].value, -22);
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
      margins: [{
        invoiceId: "invoice-1",
        costRunId: "run-1",
        marginStatus: CmInvoiceMarginStatus.WARNING,
        associatedRevenueEur: 350,
        associatedCostEur: 21,
        marginEur: 25,
        detailsJson: {
          costsByNature: { ENERGY: 15, POWER: 6 },
          rows: [
            { concept: "Energia", amount: 300, nature: "ENERGY" },
            { concept: "Potencia", amount: 50, nature: "POWER" }
          ]
        }
      }],
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

  it("usa summaryJson del run para desglosar costes cuando el job masivo no persiste detalle QH", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-1",
        invoiceDate: new Date(Date.UTC(2026, 8, 1)),
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 100)]
      }],
      curveTotals: [{ invoiceId: "invoice-1", _sum: { consumptionPfKwh: 1000, consumptionBcKwh: 1100 } }],
      costRuns: [{
        id: "run-1",
        invoiceId: "invoice-1",
        incidentsCount: 0,
        status: CmInvoiceCostRunStatus.COMPLETED,
        summaryJson: [
          { componentCode: "OMIE_MD", nature: "ENERGY", costEur: 100 },
          { componentCode: "CAD", nature: "ENERGY", costEur: 20 },
          { componentCode: "TOLLS_CHARGES_POWER", nature: "POWER", costEur: 5 }
        ]
      }],
      margins: [{
        invoiceId: "invoice-1",
        costRunId: "run-1",
        marginStatus: CmInvoiceMarginStatus.READY,
        associatedRevenueEur: 100,
        associatedCostEur: 999,
        marginEur: 10,
        detailsJson: { costsByNature: { ENERGY: 1, POWER: 2 }, rows: [{ concept: "Energia", amount: 100, nature: "ENERGY" }] }
      }],
      intervalComponentSums: [],
      powerComponentSums: []
    });
    const costs = report.rows.find((row) => row.key === "costs")!;
    const energy = costs.children?.find((row) => row.key === "costs:energy")!;
    const power = costs.children?.find((row) => row.key === "costs:power")!;
    const componentSum = (energy.children ?? []).reduce((sum, row) => sum + (row.months[8].value ?? 0), 0);

    assert.equal(costs.months[8].value, 125);
    assert.equal(energy.months[8].value, 120);
    assert.equal(energy.months[8].value, componentSum);
    assert.equal(power.months[8].value, 5);
    assert.equal(energy.children?.find((row) => row.key === "costs:energy:OMIE_MD")?.months[8].value, 100);
    assert.equal(energy.children?.find((row) => row.key === "costs:energy:CAD")?.months[8].value, 20);
  });

  it("uses the margin snapshot universe for used revenue so invoices without margin do not distort the balance", () => {
    const report = buildOperationalBalanceReport({
      year: 2026,
      availableYears: [2026],
      invoices: [{
        id: "invoice-with-margin",
        invoiceDate: new Date(Date.UTC(2026, 2, 1)),
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 100)]
      }, {
        id: "invoice-without-margin",
        invoiceDate: new Date(Date.UTC(2026, 2, 2)),
        lines: [line("Tarifas Acceso / Energia", "P1", 1, 900000)]
      }],
      curveTotals: [
        { invoiceId: "invoice-with-margin", _sum: { consumptionPfKwh: 1000, consumptionBcKwh: 1000 } },
        { invoiceId: "invoice-without-margin", _sum: { consumptionPfKwh: 2000, consumptionBcKwh: 2000 } }
      ],
      costRuns: [{ id: "run-1", invoiceId: "invoice-with-margin", incidentsCount: 0, status: CmInvoiceCostRunStatus.COMPLETED }],
      margins: [{
        invoiceId: "invoice-with-margin",
        costRunId: "run-1",
        marginStatus: CmInvoiceMarginStatus.READY,
        associatedRevenueEur: 100,
        associatedCostEur: 90,
        marginEur: 10,
        detailsJson: { costsByNature: { ENERGY: 90, POWER: 0 }, rows: [{ concept: "Energia", amount: 100, nature: "ENERGY" }] }
      }],
      intervalComponentSums: [{ costRunId: "run-1", componentCode: "OMIE_MD", costEur: 90 }],
      powerComponentSums: []
    });
    const billing = report.rows.find((row) => row.key === "billing")!;
    const revenue = report.rows.find((row) => row.key === "used-revenue")!;
    const costs = report.rows.find((row) => row.key === "costs")!;
    const margin = report.rows.find((row) => row.key === "margin")!;

    assert.equal(billing.months[2].value, 900100);
    assert.equal(revenue.months[2].value, 100);
    assert.equal(costs.months[2].value, 90);
    assert.equal(margin.months[2].value, 10);
    assert.equal(revenue.months[2].invoiceCount, 2);
    assert.equal(revenue.months[2].calculatedInvoiceCount, 1);
    assert.equal(revenue.months[2].missingInvoiceCount, 1);
  });
});

describe("Billing dashboard margin jobs", () => {
  it("recalcula margenes contra el ultimo run existente sin recalcular costes", async () => {
    let calculateCostsCalled = false;
    const updates: Array<{ message?: string | null; status?: string }> = [];
    const invoice = {
      id: "invoice-1",
      invoiceNumber: "FE-1",
      gisceInvoiceId: 1,
      processingStatus: CmInvoiceProcessingStatus.READY,
      expectedIntervals: 1,
      lines: [line("Tarifas Acceso / Energia", "P1", 1, 100)]
    };
    const prisma = {
      cmInvoice: {
        findMany: async () => [{ id: invoice.id, invoiceNumber: invoice.invoiceNumber, gisceInvoiceId: invoice.gisceInvoiceId, periodStart: null, periodEnd: null }],
        findUnique: async () => invoice
      },
      cmBillingJob: {
        update: async ({ data }: { data: { message?: string | null; status?: string } }) => {
          updates.push(data);
          return data;
        },
        updateMany: async ({ data }: { data: { message?: string | null; status?: string } }) => {
          updates.push(data);
          return { count: 1 };
        }
      },
      cmInvoiceCostRun: {
        findFirst: async () => ({ id: "run-1", invoiceId: invoice.id, incidentsCount: 0, status: CmInvoiceCostRunStatus.COMPLETED })
      },
      cmInvoiceMarginSnapshot: {
        findUnique: async () => null,
        upsert: async () => ({ id: "margin-1" })
      },
      cmInvoiceIntervalCostComponent: {
        groupBy: async () => [{ componentCode: "OMIE_MD", _sum: { costEur: 80 } }]
      },
      cmInvoicePowerCostComponent: {
        groupBy: async () => []
      },
      cmInvoiceConsumptionCurve: {
        aggregate: async () => ({ _sum: { consumptionPfKwh: 1000 } })
      }
    };
    const costsService = {
      calculateCosts: async () => {
        calculateCostsCalled = true;
        throw new Error("No debe recalcular costes");
      }
    };
    const service = new BillingDashboardService(prisma as never, null as never, null as never, null as never, costsService as never);

    await (service as never as { runCalculateMarginsJob: (jobId: string, dateFrom: string, dateTo: string, mode: "RECALCULATE") => Promise<void> }).runCalculateMarginsJob("job-1", "2026-09-01", "2026-09-30", "RECALCULATE");

    assert.equal(calculateCostsCalled, false);
    assert.ok(updates.some((update) => update.message?.includes("Margenes procesados")));
    assert.equal(updates.at(-1)?.status, "SUCCESS");
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
