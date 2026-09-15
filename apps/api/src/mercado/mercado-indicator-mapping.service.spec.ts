const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MercadoIndicatorMappingService, classifyMercadoIndicator, normalizeMercadoIndicatorText, rankMercadoIndicatorCandidates } = require("./mercado-indicator-mapping.service");

void describe("MercadoIndicatorMappingService", () => {
  void it("normaliza texto para comparar catalogo ESIOS sin acentos ni mayusculas", () => {
    assert.equal(normalizeMercadoIndicatorText("Previsión Eólica  Peninsular"), "prevision eolica peninsular");
  });

  void it("prioriza prevision eolica frente a potencia instalada", () => {
    const candidates = rankMercadoIndicatorCandidates(
      "eolica",
      [
        candidate(541, "Previsión eólica"),
        candidate(1485, "Potencia instalada de generación eólica"),
        candidate(12, "Generación programada PBF Eólica terrestre")
      ],
      new Map([[541, [{ geoId: 8741, geoKey: 8741, geoName: "Península", records: 24 }]]])
    );

    assert.equal(candidates[0].indicatorId, 541);
    assert.equal(candidates.some((item) => item.indicatorId === 1485), false);
    assert.equal(candidates.some((item) => item.indicatorId === 12), false);
    assert.ok(candidates[0].scoreBreakdown.category > 0);
  });

  void it("clasifica PBF, P48, PHF y potencia instalada antes de puntuar similitud", () => {
    assert.equal(classifyMercadoIndicator("Generacion programada PBF Nuclear"), "generacion_programada_pbf");
    assert.equal(classifyMercadoIndicator("Generacion programada P48 Nuclear"), "generacion_programada_p48");
    assert.equal(classifyMercadoIndicator("Programa horario final PHF nuclear"), "generacion_programada_phf");
    assert.equal(classifyMercadoIndicator("Potencia instalada de generacion eolica"), "potencia_instalada");
  });

  void it("prioriza generacion programada PBF nuclear frente a potencia instalada", () => {
    const candidates = rankMercadoIndicatorCandidates(
      "nuclear",
      [
        candidate(1477, "Potencia instalada de generación nuclear"),
        candidate(4, "Generación programada PBF Nuclear"),
        candidate(74, "Generación programada P48 Nuclear")
      ],
      new Map([[4, [{ geoId: 8741, geoKey: 8741, geoName: "Península", records: 24 }]]])
    );

    assert.equal(candidates[0].indicatorId, 4);
    assert.equal(candidates.some((item) => item.indicatorId === 74), false);
  });

  void it("prioriza fotovoltaica y termosolar con datos reales frente a PBF sin cargar", () => {
    const geo = new Map([
      [542, [{ geoId: 8741, geoKey: 8741, geoName: "PenÃ­nsula", records: 4344 }]],
      [543, [{ geoId: 8741, geoKey: 8741, geoName: "PenÃ­nsula", records: 4078 }]]
    ]);

    const fv = rankMercadoIndicatorCandidates(
      "fotovoltaica",
      [candidate(14, "Generacion programada PBF Solar fotovoltaica"), candidate(542, "Solar fotovoltaica")],
      geo
    );
    const termosolar = rankMercadoIndicatorCandidates(
      "termosolar",
      [candidate(15, "Generacion programada PBF Solar termica"), candidate(543, "Solar termica")],
      geo
    );

    assert.equal(fv[0].indicatorId, 542);
    assert.equal(termosolar[0].indicatorId, 543);
  });

  void it("prioriza nuclear de tiempo real frente a PBF si no hay confirmacion manual", () => {
    const candidates = rankMercadoIndicatorCandidates(
      "nuclear",
      [candidate(4, "Generacion programada PBF Nuclear"), candidate(549, "Generacion T.Real nuclear")],
      new Map()
    );

    assert.equal(candidates[0].indicatorId, 549);
  });

  void it("no usa demanda programada como proxy de intercambios", () => {
    const candidates = rankMercadoIndicatorCandidates(
      "intercambios",
      [
        candidate(545, "Demanda programada", "Incluye intercambios internacionales programados."),
        candidate(553, "Generación T.Real intercambios", "Generación medida en tiempo real producida como consecuencia de intercambios internacionales."),
        candidate(488, "Capacidad de intercambio (NTC) con Francia importación")
      ],
      new Map([[553, [{ geoId: 8741, geoKey: 8741, geoName: "Península", records: 24 }]]])
    );

    assert.equal(candidates[0].indicatorId, 553);
  });

  void it("cachea resoluciones concurrentes e invalida tras confirmar", async () => {
    const prisma = mockPrisma();
    const service = new MercadoIndicatorMappingService(prisma as never);

    const [first, second] = await Promise.all([service.resolveMappings(), service.resolveMappings()]);

    assert.equal(first.find((item) => item.variable === "demandaPrevista")?.indicatorId, 460);
    assert.equal(second.find((item) => item.variable === "demandaPrevista")?.indicatorId, 460);
    assert.equal(prisma.esiosIndicator.findManyCalls, 1);
    assert.equal(prisma.esiosIndicatorValue.groupByCalls, 1);

    await service.resolveMappings();
    assert.equal(prisma.esiosIndicator.findManyCalls, 1);

    await service.confirmMapping({ variable: "eolica", indicatorId: 541, geoId: 8741, geoKey: 8741 });
    assert.equal(prisma.mercadoIndicatorMappingConfirmation.upsertCalls, 1);
    assert.equal(prisma.esiosIndicator.findManyCalls, 2);
  });
});

function candidate(indicatorId: number, name: string, description = "") {
  const searchableText = normalizeMercadoIndicatorText(`${name} ${description}`);
  return {
    indicatorId,
    name,
    description,
    shortName: null,
    unit: "MW",
    frequency: "hour",
    searchableText,
    functionalCategory: classifyMercadoIndicator(searchableText)
  };
}

function mockPrisma() {
  const indicators = [
    candidate(460, "Demanda prevista peninsular"),
    candidate(541, "Previsión eólica"),
    candidate(1485, "Potencia instalada de generación eólica"),
    candidate(4, "Generación programada PBF Nuclear")
  ];
  return {
    esiosIndicator: {
      findManyCalls: 0,
      findMany: async function () {
        this.findManyCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return indicators;
      },
      findUnique: async ({ where }: { where: { indicatorId: number } }) => indicators.find((indicator) => indicator.indicatorId === where.indicatorId) ?? null
    },
    mercadoIndicatorMappingConfirmation: {
      upsertCalls: 0,
      findMany: async () => [],
      upsert: async function (payload: unknown) {
        this.upsertCalls += 1;
        return payload;
      }
    },
    esiosIndicatorValue: {
      groupByCalls: 0,
      groupBy: async function () {
        this.groupByCalls += 1;
        return [
          {
            indicatorId: 460,
            geoId: 8741,
            geoKey: 8741,
            geoName: "Península",
            _count: { _all: 24 }
          },
          {
            indicatorId: 541,
            geoId: 8741,
            geoKey: 8741,
            geoName: "Península",
            _count: { _all: 24 }
          },
          {
            indicatorId: 4,
            geoId: 8741,
            geoKey: 8741,
            geoName: "Península",
            _count: { _all: 24 }
          }
        ];
      }
    }
  };
}
