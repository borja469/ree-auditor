const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MercadoDatasetService } = require("./mercado-dataset.service");

void describe("MercadoDatasetService", () => {
  void it("incluye fotovoltaica, termosolar y nuclear en el dataset horario cuando hay datos", async () => {
    const service = new MercadoDatasetService(mockPrisma(), mockMappingService() as never);

    const result = await service.buildHourlyDataset({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", take: 1 });
    const first = result.rows[0];

    assert.equal(first.fotovoltaica, 40);
    assert.equal(first.termosolar, 5);
    assert.equal(first.nuclear, 100);
    assert.equal(first.dataQualityStatus, "complete");
  });

  void it("diagnostica cobertura completa y parcial por variable critica", async () => {
    const service = new MercadoDatasetService(mockPrisma({ partialNuclear: true }), mockMappingService() as never);

    const result = await service.diagnoseCoverage({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });
    const fotovoltaica = result.variables.find((item) => item.variable === "fotovoltaica");
    const nuclear = result.variables.find((item) => item.variable === "nuclear");

    assert.equal(fotovoltaica.status, "complete");
    assert.equal(fotovoltaica.coveragePct, 100);
    assert.equal(nuclear.status, "partial");
    assert.equal(nuclear.missingHoursCount, 12);
  });
});

function mockMappingService() {
  return {
    resolveDatasetMapping: async () => ({
      precioOmie: { status: "external" },
      demandaPrevista: mapping(460),
      eolica: mapping(541),
      fotovoltaica: mapping(542),
      termosolar: mapping(543),
      nuclear: mapping(549),
      hidraulicaUGH: mapping(1),
      hidraulicaNoUGH: mapping(2),
      bombeo: mapping(25),
      intercambios: mapping(553)
    })
  };
}

function mapping(indicatorId: number) {
  return {
    variable: "x",
    indicatorId,
    nombre: `Indicador ${indicatorId}`,
    geoId: 8741,
    geoKey: 8741,
    confidence: 100,
    status: "auto",
    warnings: [],
    alternatives: []
  };
}

function mockPrisma(options: { partialNuclear?: boolean } = {}) {
  const esiosRows = [
    ...indicatorRows(460, 1000, 24),
    ...indicatorRows(541, 200, 24),
    ...indicatorRows(542, 40, 24),
    ...indicatorRows(543, 5, 24),
    ...indicatorRows(549, 100, options.partialNuclear ? 12 : 24),
    ...indicatorRows(1, 20, 24),
    ...indicatorRows(2, 10, 24),
    ...indicatorRows(25, 3, 24),
    ...indicatorRows(553, -5, 24)
  ];
  return {
    omiePrice: {
      findMany: async () => Array.from({ length: 24 }, (_, index) => ({ fechaPrograma: new Date("2026-01-01T00:00:00.000Z"), periodo: index + 1, precioEurMWh: 50 }))
    },
    esiosIndicatorValue: {
      findMany: async ({ where }: { where: { indicatorId?: number | { in?: number[] } } }) => {
        const ids = typeof where.indicatorId === "object" ? (where.indicatorId.in ?? []) : [where.indicatorId];
        return esiosRows.filter((row) => ids.includes(row.indicatorId));
      }
    },
    esiosIndicator: {
      findUnique: async ({ where }: { where: { indicatorId: number } }) => ({ indicatorId: where.indicatorId, name: `Indicador ${where.indicatorId}`, shortName: null })
    }
  };
}

function indicatorRows(indicatorId: number, value: number, hours: number) {
  return Array.from({ length: hours }, (_, index) => ({
    indicatorId,
    datetimeUtc: new Date(Date.UTC(2026, 0, 1, index)),
    geoId: 8741,
    geoKey: 8741,
    geoName: "Peninsula",
    value
  }));
}
