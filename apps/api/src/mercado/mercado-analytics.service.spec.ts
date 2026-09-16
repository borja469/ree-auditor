const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MercadoAnalyticsService } = require("./mercado-analytics.service");

void describe("MercadoAnalyticsService", () => {
  void it("calcula estadisticos, correlaciones y series temporales sobre el dataset horario", async () => {
    const service = new MercadoAnalyticsService(mockDatasetService(), mockMappingService());

    const result = await service.analyze({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });

    assert.equal(result.datasetSummary.rows, 4);
    assert.equal(result.statistics.precioOmie.observations, 4);
    assert.equal(result.statistics.precioOmie.mean, 40);
    assert.equal(result.statistics.precioOmie.median, 40);
    assert.equal(result.statistics.huecoTermico.mean, 174);
    assert.equal(result.statistics.demandaResidual.mean, 281);
    assert.equal(result.correlations.withPrecioOmie[0].variable, "demandaPrevista");
    assert.equal(result.correlations.withPrecioOmie[0].pearson, 1);
    assert.equal(result.timeAnalysis.byHour.length, 4);
    assert.equal(result.chartData.scatterPlots.demandaPrevista.length, 4);
    assert.equal(result.outliers.incompleteHours.length, 1);
    assert.equal(result.quality.incompleteRows, 1);
  });

  void it("calcula hueco termico, demanda residual, ratios y rampas horarias", async () => {
    const service = new MercadoAnalyticsService(mockDatasetService(), mockMappingService());

    const result = await service.analyze({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });
    const first = result.chartData.timeSeries[0].values;
    const second = result.chartData.timeSeries[1].values;

    assert.equal(first.huecoTermico, -27);
    assert.equal(first.demandaResidual, 80);
    assert.equal(first.coberturaRenovablePct, 27);
    assert.equal(first.eolicaSobreDemandaPct, 20);
    assert.equal(first.solarSobreDemandaPct, 0);
    assert.equal(first.hidraulicaSobreDemandaPct, 7);
    assert.equal(first.nuclearSobreDemandaPct, 100);
    assert.equal(first.rampaDemanda, null);
    assert.equal(second.rampaDemanda, 200);
    assert.equal(second.rampaEolica, -1);
    assert.equal(second.rampaSolar, 0);
    assert.equal(second.rampaHuecoTermico, 201);
    assert.equal(second.rampaPrecioOmie, 20);
  });

  void it("no calcula ratios cuando la demanda es cero o nula", async () => {
    const service = new MercadoAnalyticsService(
      {
        buildHourlyDataset: async () => ({
          filters: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", geoId: null },
          mapping: {},
          totalRows: 2,
          returnedRows: 2,
          rows: [row("2026-01-01T00:00:00.000Z", 10, 0, []), { ...row("2026-01-01T01:00:00.000Z", 20, 100, []), demandaPrevista: null }]
        })
      },
      mockMappingService()
    );

    const result = await service.analyze({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });

    assert.equal(result.chartData.timeSeries[0].values.eolicaSobreDemandaPct, null);
    assert.equal(result.chartData.timeSeries[1].values.eolicaSobreDemandaPct, null);
  });

  void it("marca variables derivadas como no calculables cuando faltan inputs completos", async () => {
    const service = new MercadoAnalyticsService(
      {
        buildHourlyDataset: async () => ({
          filters: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", geoId: null },
          mapping: {},
          totalRows: 2,
          returnedRows: 2,
          rows: [
            { ...row("2026-01-01T00:00:00.000Z", 10, 100, []), solarPrevista: null, fotovoltaica: null, termosolar: null, nuclear: null },
            { ...row("2026-01-01T01:00:00.000Z", 20, 120, []), solarPrevista: null, fotovoltaica: null, termosolar: null, nuclear: null }
          ]
        })
      },
      mockMappingService()
    );

    const result = await service.analyze({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });
    const hueco = result.derivedVariables.find((item) => item.variable === "huecoTermico");
    const solarRatio = result.derivedVariables.find((item) => item.variable === "solarSobreDemandaPct");

    assert.equal(hueco.status, "not_calculable");
    assert.deepEqual(hueco.missingInputs, ["solarPrevista", "nuclear"]);
    assert.equal(solarRatio.status, "not_calculable");
    assert.ok(result.qualityReport.warnings.some((warning: string) => warning.includes("Variables derivadas no calculables")));
  });

  void it("reporta derivadas calculables cuando todos los inputs estan completos", async () => {
    const service = new MercadoAnalyticsService(mockCompleteDatasetService(), mockMappingService());

    const result = await service.analyze({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });
    const hueco = result.derivedVariables.find((item) => item.variable === "huecoTermico");

    assert.equal(hueco.status, "calculable");
    assert.equal(hueco.coveragePct, 100);
    assert.equal(result.qualityReport.derivedCoveragePct, 79.17);
    assert.equal(result.qualityReport.warnings.some((warning: string) => warning.includes("Variables derivadas no calculables")), false);
  });
});

function mockDatasetService() {
  return {
    buildHourlyDataset: async () => ({
      filters: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", geoId: null },
      mapping: {},
      totalRows: 4,
      returnedRows: 4,
      rows: [
        row("2026-01-01T00:00:00.000Z", 10, 100, []),
        row("2026-01-01T01:00:00.000Z", 30, 300, []),
        row("2026-01-01T02:00:00.000Z", 50, 500, []),
        row("2026-01-01T03:00:00.000Z", 70, 700, ["eolica"])
      ]
    })
  };
}

function mockMappingService() {
  return {
    resolveMappings: async () => []
  };
}

function mockCompleteDatasetService() {
  return {
    buildHourlyDataset: async () => ({
      filters: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", geoId: null },
      mapping: {},
      totalRows: 2,
      returnedRows: 2,
      rows: [row("2026-01-01T00:00:00.000Z", 10, 100, []), row("2026-01-01T01:00:00.000Z", 30, 300, [])]
    })
  };
}

function row(timestampUtc: string, precioOmie: number, demandaPrevista: number, missingVariables: string[]) {
  const hour = Number(timestampUtc.slice(11, 13));
  return {
    timestampUtc,
    datetimeLocal: timestampUtc.replace(".000Z", ""),
    date: "2026-01-01",
    year: 2026,
    month: 1,
    day: 1,
    hour,
    weekday: 4,
    season: "winter",
    isWeekend: false,
    precioOmie,
    demandaPrevista,
    eolica: missingVariables.includes("eolica") ? null : 20 - hour,
    solarPrevista: 0,
    fotovoltaica: 0,
    termosolar: 0,
    nuclear: 100,
    hidraulicaUGH: 5,
    hidraulicaNoUGH: 2,
    bombeo: 1,
    intercambios: -10,
    missingVariables,
    dataQualityStatus: missingVariables.length === 0 ? "complete" : "partial"
  };
}
