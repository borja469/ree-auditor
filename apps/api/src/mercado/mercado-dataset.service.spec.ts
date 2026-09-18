const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MercadoDatasetService } = require("./mercado-dataset.service");

void describe("MercadoDatasetService", () => {
  void it("incluye fotovoltaica, termosolar, nuclear y señales externas en el dataset horario cuando hay datos", async () => {
    const service = new MercadoDatasetService(mockPrisma(), mockMappingService() as never);

    const result = await service.buildHourlyDataset({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", take: 1 });
    const first = result.rows[0];

    assert.equal(first.solarPrevista, 45);
    assert.equal(first.fotovoltaica, 40);
    assert.equal(first.termosolar, 5);
    assert.equal(first.nuclear, 100);
    assert.equal(first.nuclearDisponibleMw, 7000);
    assert.equal(first.hidraulicaStorageIndex, 12345678);
    assert.equal(first.dataQualityStatus, "complete");
  });

  void it("usa el ultimo indice hidraulico semanal conocido sin mirar registros futuros", async () => {
    const service = new MercadoDatasetService(mockPrisma(), mockMappingService() as never);

    const result = await service.buildHourlyDataset({ fechaDesde: "2026-01-06", fechaHasta: "2026-01-06", take: 1 });
    const first = result.rows[0];

    assert.equal(first.hidraulicaStorageIndex, 13000000);
  });

  void it("alinea OMIE MD por hora local de mercado en horario de verano", async () => {
    const service = new MercadoDatasetService(mockPrisma({ omieProgramDate: "2026-09-16" }), mockMappingService() as never);

    const result = await service.buildHourlyDataset({ fechaDesde: "2026-09-15", fechaHasta: "2026-09-16", take: 60 });
    const firstMarketHour = result.rows.find((row) => row.datetimeLocal === "2026-09-16T00:00:00");
    const lastMarketHour = result.rows.find((row) => row.datetimeLocal === "2026-09-16T23:00:00");

    assert.equal(firstMarketHour?.timestampUtc, "2026-09-15T22:00:00.000Z");
    assert.equal(firstMarketHour?.precioOmie, 1);
    assert.equal(lastMarketHour?.timestampUtc, "2026-09-16T21:00:00.000Z");
    assert.equal(lastMarketHour?.precioOmie, 24);
  });

  void it("alinea ESIOS por dia local de mercado en horario de verano", async () => {
    const service = new MercadoDatasetService(mockPrisma({ esiosStart: "2026-09-16T22:00:00.000Z" }), mockMappingService() as never);

    const result = await service.buildHourlyDataset({ fechaDesde: "2026-09-17", fechaHasta: "2026-09-17" });

    assert.equal(result.rows.length, 24);
    assert.equal(result.rows[0].timestampUtc, "2026-09-16T22:00:00.000Z");
    assert.equal(result.rows[0].datetimeLocal, "2026-09-17T00:00:00");
    assert.equal(result.rows[0].demandaPrevista, 1000);
    assert.equal(result.rows[23].timestampUtc, "2026-09-17T21:00:00.000Z");
    assert.equal(result.rows[23].datetimeLocal, "2026-09-17T23:00:00");
    assert.equal(result.rows[23].demandaPrevista, 1000);
  });

  void it("diagnostica cobertura ESIOS contra horas locales de mercado en verano", async () => {
    const service = new MercadoDatasetService(mockPrisma({ esiosStart: "2026-09-16T22:00:00.000Z" }), mockMappingService() as never);

    const result = await service.diagnoseCoverage({ fechaDesde: "2026-09-17", fechaHasta: "2026-09-17" });
    const demanda = result.variables.find((item) => item.variable === "demandaPrevista");

    assert.equal(result.expectedHours, 24);
    assert.equal(demanda?.status, "complete");
    assert.equal(demanda?.coveragePct, 100);
    assert.equal(demanda?.missingHoursCount, 0);
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

  void it("diagnostica cobertura de variables D+1 usadas por forecast", async () => {
    const service = new MercadoDatasetService(mockPrisma(), mockMappingService() as never);

    const result = await service.diagnoseCoverage({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" });
    const ccgt = result.forecastD1Variables.find((item) => item.variable === "ccgtDisponibleMw");
    const ntcFranceImport = result.forecastD1Variables.find((item) => item.variable === "ntcFranceImportD1");

    assert.equal(ccgt.status, "complete");
    assert.equal(ccgt.distinctHours, 24);
    assert.equal(ntcFranceImport.status, "complete");
    assert.equal(ntcFranceImport.indicatorId, 1844);
  });
});

function mockMappingService() {
  return {
    resolveDatasetMapping: async () => ({
      precioOmie: { status: "external" },
      demandaPrevista: mapping(460),
      eolica: mapping(541),
      solarPrevista: mapping(10034),
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

function mockPrisma(options: { partialNuclear?: boolean; omieProgramDate?: string; esiosStart?: string } = {}) {
  const esiosStart = options.esiosStart ?? "2025-12-31T23:00:00.000Z";
  const esiosRows = [
    ...indicatorRows(460, 1000, 24, esiosStart),
    ...indicatorRows(541, 200, 24, esiosStart),
    ...indicatorRows(10034, 45, 24, esiosStart),
    ...indicatorRows(542, 40, 24, esiosStart),
    ...indicatorRows(543, 5, 24, esiosStart),
    ...indicatorRows(549, 100, options.partialNuclear ? 12 : 24, esiosStart),
    ...nuclearAvailabilityRows(24, esiosStart),
    ...hydraulicStorageRows(),
    ...indicatorRows(1844, 1200, 24, esiosStart),
    ...indicatorRows(1848, 900, 24, esiosStart),
    ...indicatorRows(1845, 1000, 24, esiosStart),
    ...indicatorRows(1849, 800, 24, esiosStart),
    ...indicatorRows(1846, 600, 24, esiosStart),
    ...indicatorRows(1850, 900, 24, esiosStart),
    ...indicatorRows(477, 2500, 24, esiosStart),
    ...indicatorRows(472, 12000, 24, esiosStart),
    ...indicatorRows(473, 180, 24, esiosStart),
    ...indicatorRows(1, 20, 24, esiosStart),
    ...indicatorRows(2, 10, 24, esiosStart),
    ...indicatorRows(25, 3, 24, esiosStart),
    ...indicatorRows(553, -5, 24, esiosStart)
  ];
  return {
    omiePrice: {
      findMany: async () =>
        Array.from({ length: 24 }, (_, index) => ({
          fechaPrograma: new Date(`${options.omieProgramDate ?? "2026-01-01"}T00:00:00.000Z`),
          periodo: index + 1,
          precioEurMWh: options.omieProgramDate ? index + 1 : 50
        }))
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

function indicatorRows(indicatorId: number, value: number, hours: number, startIso: string) {
  const start = new Date(startIso).getTime();
  return Array.from({ length: hours }, (_, index) => ({
    indicatorId,
    datetimeUtc: new Date(start + index * 60 * 60 * 1000),
    geoId: 8741,
    geoKey: 8741,
    geoName: "Peninsula",
    value
  }));
}

function nuclearAvailabilityRows(hours: number, startIso: string) {
  const start = new Date(startIso).getTime();
  const centrales = [
    { geoId: 35, geoName: "Valencia", value: 2000 },
    { geoId: 37, geoName: "Caceres", value: 1800 },
    { geoId: 42, geoName: "Tarragona", value: 1700 },
    { geoId: 60, geoName: "Guadalajara", value: 1500 }
  ];
  return Array.from({ length: hours }, (_, index) =>
    centrales.map((central) => ({
      indicatorId: 474,
      datetimeUtc: new Date(start + index * 60 * 60 * 1000),
      geoId: central.geoId,
      geoKey: central.geoId,
      geoName: central.geoName,
      value: central.value
    }))
  ).flat();
}

function hydraulicStorageRows() {
  return [
    {
      indicatorId: 623,
      datetimeUtc: new Date("2025-12-29T00:00:00.000Z"),
      geoId: 8741,
      geoKey: 8741,
      geoName: "Peninsula",
      value: 12345678
    },
    {
      indicatorId: 623,
      datetimeUtc: new Date("2026-01-05T00:00:00.000Z"),
      geoId: 8741,
      geoKey: 8741,
      geoName: "Peninsula",
      value: 13000000
    }
  ];
}
