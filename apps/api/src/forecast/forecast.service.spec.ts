const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { ForecastDatasetBuilderService } = require("./prediction-engine/dataset-builder.service");
const { ForecastEvaluationService } = require("./prediction-engine/evaluation.service");
const { ForecastFeatureImportanceService } = require("./prediction-engine/feature-importance.service");
const { ForecastComparisonService } = require("./forecast-comparison.service");
const { LinearRegressionModel } = require("./prediction-engine/linear-regression.model");
const { ForecastModelFactory } = require("./prediction-engine/model-factory");
const { ForecastModelStoreService } = require("./forecast-model-store.service");
const { ForecastPredictionRunStoreService } = require("./forecast-prediction-run-store.service");
const { ForecastPredictionService } = require("./prediction.service");
const { ForecastTrainingService } = require("./prediction-engine/training.service");
const { ForecastValidationService } = require("./prediction-engine/validation.service");
const { RandomForestModel } = require("./prediction-engine/random-forest.model");

void describe("Forecast prediction engine", () => {
  void it("entrena una regresion lineal multiple usando la interfaz comun", async () => {
    const evaluation = new ForecastEvaluationService();
    const model = new LinearRegressionModel(evaluation);
    const dataset = {
      featureNames: ["x"],
      excludedFeatures: [],
      metadata: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-01", totalRows: 30, targetRows: 30, trainingRows: 30, mappingVariables: 0 },
      rows: Array.from({ length: 30 }, (_, index) => ({
        timestampUtc: `2026-01-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
        target: 5 + 2 * index,
        features: { x: index }
      }))
    };

    const snapshot = await model.train(dataset);
    const predictions = await model.predict(dataset);

    assert.equal(snapshot.model, "linear");
    assert.deepEqual(snapshot.variables, ["x"]);
    assert.equal(typeof snapshot.featureStats.x.mean, "number");
    assert.equal(snapshot.featureStats.x.stdDev > 0, true);
    assert.ok(Math.abs(predictions[0].predicted - 5) < 0.01);
    assert.ok(Math.abs(predictions[29].predicted - 63) < 0.01);
    assert.equal(snapshot.metrics.r > 0.999, true);
    assert.equal(snapshot.metrics.mae !== null && snapshot.metrics.mae < 0.01, true);
    assert.equal(snapshot.metrics.rmse !== null && snapshot.metrics.rmse < 0.01, true);
  });

  void it("construye un dataset de entrenamiento y excluye variables sin cobertura", async () => {
    const builder = new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService());

    const dataset = await builder.buildTrainingDataset({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-02" });

    assert.equal(dataset.metadata.totalRows, 48);
    assert.equal(dataset.metadata.trainingRows >= 24, true);
    assert.equal(dataset.featureNames.includes("demandaPrevista"), true);
    assert.equal(dataset.featureNames.includes("demandaResidual"), true);
    assert.equal(dataset.featureNames.includes("solarSobreDemandaPct"), true);
    assert.equal(dataset.featureNames.includes("renewablePressurePct"), true);
    assert.equal(dataset.featureNames.includes("residualDemandLow"), true);
    assert.equal(dataset.featureNames.includes("solarPressureHigh"), true);
    assert.equal(dataset.featureNames.includes("nuclear"), false);
    assert.equal(dataset.excludedFeatures.some((item: { variable: string }) => item.variable === "nuclear"), true);
    assert.equal(dataset.rows.every((row: { features: Record<string, number> }) => Number.isFinite(row.features.demandaPrevista)), true);
  });

  void it("entrena desde ForecastTrainingService con factory desacoplada", async () => {
    const evaluation = new ForecastEvaluationService();
    const builder = new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService());
    const factory = new ForecastModelFactory(evaluation);
    const training = new ForecastTrainingService(builder, factory, mockModelStore(), new ForecastValidationService(factory), new ForecastFeatureImportanceService());

    const result = await training.train({ fechaDesde: "2026-01-01", fechaHasta: "2026-01-02", modelo: "linear" });

    assert.equal(result.modelo, "linear");
    assert.equal(result.version, 1);
    assert.equal(result.numeroObservaciones >= 24, true);
    assert.equal(result.variablesUtilizadas.length > 0, true);
    assert.equal(result.featureImportance.length > 0, true);
    assert.equal(typeof result.walkForwardMetricas.folds, "number");
    assert.equal(typeof result.tiempoEntrenamientoMs, "number");
    assert.equal(typeof result.coeficientes, "object");
  });

  void it("entrena y recarga randomForest para patrones no lineales", async () => {
    const evaluation = new ForecastEvaluationService();
    const model = new RandomForestModel(evaluation);
    const dataset = makeNonLinearDataset();

    const snapshot = await model.train(dataset);
    const loaded = new RandomForestModel(evaluation);
    await loaded.load(snapshot);
    const predictions = await loaded.predict(dataset);

    assert.equal(snapshot.model, "randomForest");
    assert.deepEqual(snapshot.variables, ["solarPressureHigh", "demandaResidual", "precioGasMibgas"]);
    assert.equal(typeof snapshot.coefficients.__rf_treeCount, "number");
    assert.equal(predictions.length, dataset.rows.length);
    assert.equal(snapshot.metrics.mae !== null && snapshot.metrics.mae < 15, true);
  });

  void it("expone randomForest como modelo disponible", () => {
    const factory = new ForecastModelFactory(new ForecastEvaluationService());

    const definitions = factory.listModels();

    assert.equal(definitions.find((definition: { id: string }) => definition.id === "randomForest").status, "available");
    assert.equal(factory.create("randomForest").name, "randomForest");
  });

  void it("activa modelos dejando solo uno activo", async () => {
    const store = new ForecastModelStoreService(mockPrisma());
    const first = await store.createVersion(createStoredInput("2026-01-01", "2026-01-02"));
    const second = await store.createVersion(createStoredInput("2026-02-01", "2026-02-02"));

    await store.activateModel(first.id);
    const activatedSecond = await store.activateModel(second.id);
    const models = await store.listModels();

    assert.equal(activatedSecond.activo, true);
    assert.equal(models.filter((model: { activo: boolean }) => model.activo).length, 1);
    assert.equal(models.find((model: { id: string }) => model.id === second.id).activo, true);
  });

  void it("ejecuta prediccion cargando un modelo versionado", async () => {
    const evaluation = new ForecastEvaluationService();
    const factory = new ForecastModelFactory(evaluation);
    const store = mockModelStore({
      id: "11111111-1111-4111-8111-111111111111",
      tipo: "linear",
      version: 1,
      fecha: "2026-01-02T00:00:00.000Z",
      variablesUtilizadas: ["demandaPrevista"],
      intercepto: 1,
      coeficientes: { demandaPrevista: 0.5 },
      metricasCompletas: { r: 1, mae: 0, rmse: 0 }
    });
    const runStore = mockPredictionRunStore();
    const prediction = new ForecastPredictionService(store, new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService()), factory, runStore);

    const result = await prediction.predict({ modeloId: "11111111-1111-4111-8111-111111111111", fecha: "2026-01-01" });

    assert.equal(result.modelo, "linear");
    assert.equal(result.prediccionesHorarias.length, 24);
    assert.equal(result.precioPrevisto > 0, true);
    assert.equal(runStore.runs.length, 1);
    assert.equal(runStore.runs[0].tipoPrediccion, "daily");
  });

  void it("omite variables no disponibles en prediccion como rampaPrecioOmie para modelos ya entrenados", async () => {
    const builder = new ForecastDatasetBuilderService(mockMercadoDatasetServiceWithoutFuturePrice(), mockMappingService());

    const dataset = await builder.buildPredictionDataset({
      fecha: "2026-01-01",
      featureNames: ["demandaPrevista", "rampaPrecioOmie"]
    });

    assert.equal(dataset.featureNames.includes("demandaPrevista"), true);
    assert.equal(dataset.featureNames.includes("rampaPrecioOmie"), false);
    assert.equal(dataset.excludedFeatures.some((item: { variable: string }) => item.variable === "rampaPrecioOmie"), true);
    assert.equal(dataset.rows.length, 24);
  });

  void it("incluye la primera hora de un rango de prediccion cuando el modelo usa rampas", async () => {
    const builder = new ForecastDatasetBuilderService(mockMercadoDatasetServiceByDateRange(), mockMappingService());

    const dataset = await builder.buildPredictionRangeDataset({
      fechaDesde: "2026-01-02",
      fechaHasta: "2026-01-02",
      featureNames: ["rampaDemanda"]
    });

    assert.equal(dataset.rows.length, 24);
    assert.equal(dataset.rows[0].timestampUtc, "2026-01-02T00:00:00.000Z");
    assert.equal(Number.isFinite(dataset.rows[0].features.rampaDemanda), true);
    assert.equal(dataset.metadata.fechaDesde, "2026-01-02");
    assert.equal(dataset.metadata.totalRows, 24);
  });

  void it("bloquea prediccion si falta una variable requerida no derivada del precio real", async () => {
    const builder = new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService());

    await assert.rejects(
      () =>
        builder.buildPredictionDataset({
          fecha: "2026-01-01",
          featureNames: ["demandaPrevista", "nuclear"]
        }),
      /variables sin cobertura/
    );
  });

  void it("bloquea predicciones con modelos entrenados con rampaPrecioOmie", async () => {
    const evaluation = new ForecastEvaluationService();
    const factory = new ForecastModelFactory(evaluation);
    const store = mockModelStore({ variablesUtilizadas: ["demandaPrevista", "rampaPrecioOmie"] });
    const prediction = new ForecastPredictionService(store, new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService()), factory, mockPredictionRunStore());

    await assert.rejects(
      () => prediction.predictRange({ modeloId: "11111111-1111-4111-8111-111111111111", fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" }),
      /Entrena una nueva version/
    );
  });

  void it("bloquea predicciones fuera de rango operativo", async () => {
    const evaluation = new ForecastEvaluationService();
    const factory = new ForecastModelFactory(evaluation);
    const store = mockModelStore({ variablesUtilizadas: ["demandaPrevista"], intercepto: 0, coeficientes: { demandaPrevista: -2000 } });
    const prediction = new ForecastPredictionService(store, new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService()), factory, mockPredictionRunStore());

    await assert.rejects(
      () => prediction.predictRange({ modeloId: "11111111-1111-4111-8111-111111111111", fechaDesde: "2026-01-01", fechaHasta: "2026-01-01" }),
      /fuera de rango operativo/
    );
  });

  void it("compara modelos y recomienda el menor RMSE y MAE", async () => {
    const comparison = new ForecastComparisonService(
      mockModelStoreById({
        a: { id: "a", version: 1, metricasCompletas: { r: 0.9, mae: 3, rmse: 6 } },
        b: { id: "b", version: 2, metricasCompletas: { r: 0.8, mae: 2, rmse: 4 } }
      })
    );

    const result = await comparison.compare(["a", "b"]);

    assert.equal(result.models.length, 2);
    assert.equal(result.recomendacion.modeloId, "b");
  });

  void it("ejecuta prediccion por rango agrupada por fecha y audita la ejecucion", async () => {
    const evaluation = new ForecastEvaluationService();
    const factory = new ForecastModelFactory(evaluation);
    const store = mockModelStore({ variablesUtilizadas: ["demandaPrevista"], intercepto: 1, coeficientes: { demandaPrevista: 0.5 } });
    const runStore = mockPredictionRunStore();
    const prediction = new ForecastPredictionService(store, new ForecastDatasetBuilderService(mockMercadoDatasetService(), mockMappingService()), factory, runStore);

    const result = await prediction.predictRange({ modeloId: "11111111-1111-4111-8111-111111111111", fechaDesde: "2026-01-01", fechaHasta: "2026-01-02" }, "operaciones");

    assert.equal(result.predicciones.length, 2);
    assert.equal(result.predicciones[0].prediccionesHorarias.length, 24);
    assert.equal(runStore.runs.length, 1);
    assert.equal(runStore.runs[0].tipoPrediccion, "range");
    assert.equal(runStore.runs[0].usuario, "operaciones");
  });

  void it("guarda auditoria de predicciones y filtra historico", async () => {
    const store = new ForecastPredictionRunStoreService(mockPrisma());

    await store.create({
      modeloId: "11111111-1111-4111-8111-111111111111",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-01-01",
      tipoPrediccion: "daily",
      input: { fecha: "2026-01-01" },
      output: { precioPrevisto: 50 },
      usuario: "operaciones"
    });
    await store.create({
      modeloId: "22222222-2222-4222-8222-222222222222",
      fechaDesde: "2026-02-01",
      fechaHasta: "2026-02-01",
      tipoPrediccion: "daily",
      input: { fecha: "2026-02-01" },
      output: { precioPrevisto: 60 },
      usuario: "operaciones"
    });

    const filtered = await store.list({ modeloId: "11111111-1111-4111-8111-111111111111", fechaDesde: "2026-01-01", fechaHasta: "2026-01-31" });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].modeloId, "11111111-1111-4111-8111-111111111111");
  });

  void it("calcula walk forward validation por meses", async () => {
    const evaluation = new ForecastEvaluationService();
    const factory = new ForecastModelFactory(evaluation);
    const validation = new ForecastValidationService(factory);
    const dataset = makeLinearDatasetAcrossMonths();

    const result = await validation.walkForward(dataset, "linear");

    assert.equal(result.folds >= 1, true);
    assert.equal(result.mae !== null, true);
    assert.equal(result.rmse !== null, true);
  });

  void it("calcula feature importance normalizada", () => {
    const importance = new ForecastFeatureImportanceService();
    const dataset = makeFeatureImportanceDataset();

    const result = importance.calculate(dataset, { demandaPrevista: 2, eolica: 1 });

    assert.equal(result[0].variable, "demandaPrevista");
    assert.equal(Math.round(result.reduce((sum: number, row: { importance: number }) => sum + row.importance, 0) * 1000) / 1000, 1);
  });
});

function mockMappingService() {
  return {
    resolveMappings: async () => []
  };
}

function mockMercadoDatasetService() {
  return {
    buildHourlyDataset: async (options?: { fechaDesde?: string; fechaHasta?: string }) => {
      const total = options?.fechaDesde === options?.fechaHasta ? 24 : 48;
      const rows = Array.from({ length: total }, (_, index) => row(index));
      return {
        filters: { fechaDesde: options?.fechaDesde ?? "2026-01-01", fechaHasta: options?.fechaHasta ?? "2026-01-02", geoId: null },
        totalRows: rows.length,
        returnedRows: rows.length,
        rows
      };
    }
  };
}

function mockMercadoDatasetServiceWithoutFuturePrice() {
  return {
    buildHourlyDataset: async (options?: { fechaDesde?: string; fechaHasta?: string }) => {
      const total = options?.fechaDesde === options?.fechaHasta ? 24 : 48;
      const rows = Array.from({ length: total }, (_, index) => ({ ...row(index), precioOmie: null }));
      return {
        filters: { fechaDesde: options?.fechaDesde ?? "2026-01-01", fechaHasta: options?.fechaHasta ?? "2026-01-02", geoId: null },
        totalRows: rows.length,
        returnedRows: rows.length,
        rows
      };
    }
  };
}

function mockMercadoDatasetServiceByDateRange() {
  return {
    buildHourlyDataset: async (options?: { fechaDesde?: string; fechaHasta?: string }) => {
      const fechaDesde = options?.fechaDesde ?? "2026-01-01";
      const fechaHasta = options?.fechaHasta ?? fechaDesde;
      const rows = rowsForDateRange(fechaDesde, fechaHasta);
      return {
        filters: { fechaDesde, fechaHasta, geoId: null },
        totalRows: rows.length,
        returnedRows: rows.length,
        rows
      };
    }
  };
}

function mockModelStore(model?: Record<string, unknown>) {
  return {
    createVersion: async (input: Record<string, unknown>) => ({
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      activo: false,
      ...input
    }),
    getModel: async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      nombre: "Mercado forecast linear",
      version: 1,
      activo: true,
      fecha: "2026-01-02T00:00:00.000Z",
      tipo: "linear",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-01-02",
      variablesUtilizadas: ["demandaPrevista"],
      variablesDescartadas: [],
      coeficientes: { demandaPrevista: 0.01 },
      featureStats: {},
      intercepto: 20,
      metricas: { r: 1, mae: 0, rmse: 0 },
      metricasCompletas: { r: 1, mae: 0, rmse: 0 },
      walkForwardMetricas: { r: null, mae: null, rmse: null, folds: 0 },
      featureImportance: [],
      numeroRegistros: 48,
      duracionMs: 1,
      usuario: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      ...model
    })
  };
}

function mockModelStoreById(models: Record<string, Record<string, unknown>>) {
  return {
    getModel: async (id: string) => ({
      id,
      nombre: `Modelo ${id}`,
      version: 1,
      activo: false,
      fecha: "2026-01-02T00:00:00.000Z",
      tipo: "linear",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-01-02",
      variablesUtilizadas: ["demandaPrevista"],
      variablesDescartadas: [],
      coeficientes: { demandaPrevista: 0.01 },
      featureStats: {},
      intercepto: 20,
      metricas: { r: 1, mae: 0, rmse: 0 },
      metricasCompletas: { r: 1, mae: 0, rmse: 0 },
      walkForwardMetricas: { r: null, mae: null, rmse: null, folds: 0 },
      featureImportance: [{ variable: "demandaPrevista", importance: 1 }],
      numeroRegistros: 48,
      duracionMs: 1,
      usuario: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      ...models[id]
    })
  };
}

function mockPredictionRunStore() {
  const runs: Array<Record<string, unknown>> = [];
  return {
    runs,
    create: async (input: Record<string, unknown>) => {
      const row = { id: `${runs.length + 1}`, createdAt: "2026-01-01T00:00:00.000Z", ...input };
      runs.push(row);
      return row;
    }
  };
}

function mockPrisma() {
  const rows: Array<Record<string, unknown>> = [];
  const predictionRuns: Array<Record<string, unknown>> = [];
  return {
    forecastModel: {
      findMany: async () => [...rows].sort((left, right) => Number(right.version) - Number(left.version)),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { tipoModelo: string } }) =>
        [...rows].filter((row) => row.tipoModelo === where.tipoModelo).sort((left, right) => Number(right.version) - Number(left.version))[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `${rows.length + 1}1111111-1111-4111-8111-111111111111`,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          ...data,
          intercepto: { toString: () => String(data.intercepto) }
        };
        rows.push(row);
        return row;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        for (const row of rows) {
          row.activo = data.activo;
        }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((item) => item.id === where.id);
        Object.assign(row, data, { updatedAt: new Date("2026-01-01T00:00:00.000Z") });
        return row;
      }
    },
    forecastPredictionRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `${predictionRuns.length + 1}2222222-2222-4222-8222-222222222222`,
          fechaEjecucion: new Date("2026-01-03T00:00:00.000Z"),
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
          ...data
        };
        predictionRuns.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { modeloId?: string; fechaDesde?: { lte?: Date }; fechaHasta?: { gte?: Date } } }) =>
        predictionRuns.filter((row) => {
          if (where.modeloId && row.modeloId !== where.modeloId) {
            return false;
          }
          const fechaDesde = row.fechaDesde as Date;
          const fechaHasta = row.fechaHasta as Date;
          if (where.fechaHasta?.gte && fechaHasta < where.fechaHasta.gte) {
            return false;
          }
          if (where.fechaDesde?.lte && fechaDesde > where.fechaDesde.lte) {
            return false;
          }
          return true;
        })
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations)
  };
}

function createStoredInput(fechaDesde: string, fechaHasta: string) {
  return {
    nombre: "Mercado forecast linear",
    tipoModelo: "linear",
    fechaEntrenamiento: "2026-01-01T00:00:00.000Z",
    fechaDesde,
    fechaHasta,
    variablesUtilizadas: ["demandaPrevista"],
    variablesDescartadas: [],
    coeficientes: { demandaPrevista: 0.01 },
    featureStats: {},
    intercepto: 20,
    metricas: { r: 1, mae: 0, rmse: 0 },
    walkForwardMetricas: { r: null, mae: null, rmse: null, folds: 0 },
    featureImportance: [{ variable: "demandaPrevista", importance: 1 }],
    numeroRegistros: 48,
    duracionMs: 10,
    usuario: "test"
  };
}

function makeLinearDatasetAcrossMonths() {
  const rows = Array.from({ length: 24 * 120 }, (_, index) => ({
    timestampUtc: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    target: 10 + index * 0.1,
    features: { x: index }
  }));
  return {
    rows,
    featureNames: ["x"],
    excludedFeatures: [],
    metadata: { fechaDesde: "2026-01-01", fechaHasta: "2026-04-30", totalRows: rows.length, targetRows: rows.length, trainingRows: rows.length, mappingVariables: 0 }
  };
}

function makeFeatureImportanceDataset() {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    timestampUtc: `2026-01-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    target: index,
    features: { demandaPrevista: index * 10, eolica: index }
  }));
  return {
    rows,
    featureNames: ["demandaPrevista", "eolica"],
    excludedFeatures: [],
    metadata: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-02", totalRows: rows.length, targetRows: rows.length, trainingRows: rows.length, mappingVariables: 0 }
  };
}

function makeNonLinearDataset() {
  const rows = Array.from({ length: 240 }, (_, index) => {
    const hour = index % 24;
    const day = Math.floor(index / 24);
    const solarPressureHigh = hour >= 10 && hour <= 17 ? 20 + (day % 3) : 0;
    const demandaResidual = solarPressureHigh > 0 ? 8000 + day * 8 : 18000 + hour * 120;
    const precioGasMibgas = 70 + (day % 5);
    const target = solarPressureHigh > 0 && demandaResidual < 9500 ? 5 + (day % 2) : 80 + precioGasMibgas + hour * 1.5;
    return {
      timestampUtc: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      target,
      features: { solarPressureHigh, demandaResidual, precioGasMibgas }
    };
  });
  return {
    rows,
    featureNames: ["solarPressureHigh", "demandaResidual", "precioGasMibgas"],
    excludedFeatures: [],
    metadata: { fechaDesde: "2026-01-01", fechaHasta: "2026-01-10", totalRows: rows.length, targetRows: rows.length, trainingRows: rows.length, mappingVariables: 0 }
  };
}

function row(index: number) {
  const date = index < 24 ? "2026-01-01" : "2026-01-02";
  const hour = index % 24;
  const demandaPrevista = 1000 + index * 10;
  return {
    timestampUtc: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    datetimeLocal: `${date}T${String(hour).padStart(2, "0")}:00:00`,
    date,
    year: 2026,
    month: 1,
    day: index < 24 ? 1 : 2,
    hour,
    weekday: index < 24 ? 4 : 5,
    season: "winter",
    isWeekend: false,
    precioOmie: 20 + demandaPrevista * 0.01,
    demandaPrevista,
    eolica: 100 + hour,
    fotovoltaica: hour >= 8 && hour <= 18 ? 60 : 0,
    termosolar: hour >= 9 && hour <= 17 ? 20 : 0,
    nuclear: null,
    hidraulicaUGH: 40,
    hidraulicaNoUGH: 10,
    bombeo: 5,
    intercambios: -20,
    missingVariables: ["nuclear"],
    dataQualityStatus: "partial"
  };
}

function rowsForDateRange(fechaDesde: string, fechaHasta: string) {
  const rows = [];
  const start = new Date(`${fechaDesde}T00:00:00.000Z`);
  const end = new Date(`${fechaHasta}T00:00:00.000Z`);
  for (let date = new Date(start), dayIndex = 0; date <= end; date.setUTCDate(date.getUTCDate() + 1), dayIndex += 1) {
    const dateText = date.toISOString().slice(0, 10);
    for (let hour = 0; hour < 24; hour += 1) {
      rows.push(rowForDateHour(dateText, dayIndex, hour));
    }
  }
  return rows;
}

function rowForDateHour(date: string, dayIndex: number, hour: number) {
  const demandaPrevista = 1000 + dayIndex * 240 + hour * 10;
  return {
    timestampUtc: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    datetimeLocal: `${date}T${String(hour).padStart(2, "0")}:00:00`,
    date,
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
    hour,
    weekday: 4,
    season: "winter",
    isWeekend: false,
    precioOmie: 20 + demandaPrevista * 0.01,
    demandaPrevista,
    eolica: 100 + hour,
    fotovoltaica: hour >= 8 && hour <= 18 ? 60 : 0,
    termosolar: hour >= 9 && hour <= 17 ? 20 : 0,
    nuclear: null,
    hidraulicaUGH: 40,
    hidraulicaNoUGH: 10,
    bombeo: 5,
    intercambios: -20,
    missingVariables: ["nuclear"],
    dataQualityStatus: "partial"
  };
}
