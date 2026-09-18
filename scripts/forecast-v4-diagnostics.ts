import "reflect-metadata";
import fs from "node:fs";
import path from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../apps/api/src/app.module";
import { ForecastDatasetBuilderService } from "../apps/api/src/forecast/prediction-engine/dataset-builder.service";
import { ForecastModelStoreService } from "../apps/api/src/forecast/forecast-model-store.service";
import { ForecastModelFactory } from "../apps/api/src/forecast/prediction-engine/model-factory";
import { ForecastDataset, ForecastFeatureRow, PredictionModel, PredictionResult } from "../apps/api/src/forecast/prediction-engine/prediction-model.interface";

const MODEL_V1_ID = process.env.FORECAST_DIAG_V1_ID ?? "2692a6a9-d09f-48ef-9f3b-d32c00a7c96e";
const MODEL_V4_ID = process.env.FORECAST_DIAG_V4_ID ?? "680be797-6817-4fc6-b915-29a636b9e407";
const OUT_DIR = path.resolve(process.cwd(), "reports", "forecast-v4-diagnostics");
const MODEL_ID = "gradientBoostingD1";

const INDIVIDUAL_ABLATIONS = [
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "huecoAjustadoInterconexion",
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "thermalGapRampPressure",
  "demandRampThermalPressure"
];

const GROUP_ABLATIONS: Record<string, string[]> = {
  hydro_new: ["hydroScarcityThermalPressure", "hydroSupportRatio", "lowStorageHighGap"],
  interconnections_new: ["ntcNetSobreDemandaPct", "exportPressure", "importSupport", "huecoAjustadoInterconexion"],
  thermal_pressure_new: ["huecoTermicoSobreDemandaPct", "huecoSobreCcgtDisponible", "huecoSobreDespachableDisponible", "margenDespachableMw"],
  ramps_new: ["thermalGapRampPressure", "demandRampThermalPressure"]
};

const NEW_FEATURES = [
  "huecoTermicoSobreDemandaPct",
  "huecoSobreCcgtDisponible",
  "huecoSobreDespachableDisponible",
  "margenDespachableMw",
  "ntcNetSobreDemandaPct",
  "exportPressure",
  "importSupport",
  "huecoAjustadoInterconexion",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "lowStorageHighGap",
  "thermalGapRampPressure",
  "demandRampThermalPressure"
];

const CORRELATION_BASE_FEATURES = [
  "huecoTermicoD1",
  "demandaResidual",
  "hidraulicaStorageIndex",
  "hidraulicaStorageLow",
  "hydroDisponibleMw",
  "ccgtDisponibleMw",
  "ntcNetImportD1",
  "ntcImportTotalD1",
  "ntcExportTotalD1",
  "rampaHuecoTermicoD1",
  "rampaDemanda"
];

const ERROR_DETAIL_FEATURES = [
  "precioOmieLag24Night",
  "huecoTermicoD1",
  "hydroScarcityThermalPressure",
  "hydroSupportRatio",
  "huecoAjustadoInterconexion",
  "huecoTermicoSobreDemandaPct",
  "precioGasMibgas",
  "demandaPrevista",
  "eolica",
  "solarPrevista",
  "nuclearDisponibleMw",
  "ccgtDisponibleMw",
  "hydroDisponibleMw",
  "ntcNetImportD1"
];

type StoredModel = Awaited<ReturnType<ForecastModelStoreService["getModel"]>>;

type JoinedPrediction = {
  timestampUtc: string;
  date: string;
  datetimeLocal: string;
  month: string;
  hour: number;
  weekday: number;
  actual: number;
  predV1: number;
  predV4: number;
  features: Record<string, number>;
};

type AblationResult = {
  removed: string;
  N: number;
  MAE: number | null;
  delta_MAE_vs_v4: number | null;
  RMSE: number | null;
  delta_RMSE_vs_v4: number | null;
  MAE_18_23: number | null;
  MAE_hueco_P90: number | null;
  MAE_precio_P90: number | null;
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const builder = app.get(ForecastDatasetBuilderService);
    const store = app.get(ForecastModelStoreService);
    const factory = app.get(ForecastModelFactory);

    const [modelV1, modelV4] = await Promise.all([store.getModel(MODEL_V1_ID), store.getModel(MODEL_V4_ID)]);
    const fechaDesde = process.env.FORECAST_DIAG_FROM ?? modelV4.fechaDesde;
    const fechaHasta = process.env.FORECAST_DIAG_TO ?? modelV4.fechaHasta;

    console.log(`[forecast-v4-diagnostics] Building dataset ${fechaDesde}..${fechaHasta}`);
    const dataset = await builder.buildTrainingDataset({ fechaDesde, fechaHasta, modelo: MODEL_ID });
    const rowsV4 = completeRows(dataset.rows, modelV4.variablesUtilizadas);
    const rowsV1 = completeRows(dataset.rows, modelV1.variablesUtilizadas);
    const commonTimestamps = intersectSets(new Set(rowsV4.map((row) => row.timestampUtc)), new Set(rowsV1.map((row) => row.timestampUtc)));
    const comparableRows = rowsV4.filter((row) => commonTimestamps.has(row.timestampUtc));

    console.log(`[forecast-v4-diagnostics] Dataset rows=${dataset.rows.length} v4Rows=${rowsV4.length} comparableRows=${comparableRows.length}`);
    const folds = buildMonthlyFolds(comparableRows);
    console.log(`[forecast-v4-diagnostics] Folds=${folds.length}`);

    const foldRows: Record<string, unknown>[] = [];
    const joinedPredictions: JoinedPrediction[] = [];

    for (const [foldIndex, fold] of folds.entries()) {
      console.log(`[forecast-v4-diagnostics] Fold ${foldIndex + 1}/${folds.length} validation=${fold.validationMonth}`);
      const v4Predictions = await trainAndPredict(factory, modelV4.variablesUtilizadas, fold.trainRows, fold.validationRows);
      const v1Predictions = await trainAndPredict(factory, modelV1.variablesUtilizadas, fold.trainRows, fold.validationRows);
      const v4Metrics = metrics(v4Predictions);
      const v1Metrics = metrics(v1Predictions);
      const joined = joinPredictions(fold.validationRows, v1Predictions, v4Predictions);
      joinedPredictions.push(...joined);
      foldRows.push({
        fold: foldIndex + 1,
        train_start: minString(fold.trainRows.map((row) => row.timestampUtc)),
        train_end: maxString(fold.trainRows.map((row) => row.timestampUtc)),
        validation_start: minString(fold.validationRows.map((row) => row.timestampUtc)),
        validation_end: maxString(fold.validationRows.map((row) => row.timestampUtc)),
        n_train: fold.trainRows.length,
        n_validation: fold.validationRows.length,
        MAE_v4: v4Metrics.MAE,
        RMSE_v4: v4Metrics.RMSE,
        bias_v4: v4Metrics.bias,
        r_v4: v4Metrics.r,
        MAE_v1: v1Metrics.MAE,
        RMSE_v1: v1Metrics.RMSE,
        bias_v1: v1Metrics.bias,
        delta_MAE_v4_vs_v1: nullableDiff(v4Metrics.MAE, v1Metrics.MAE)
      });
    }

    const huecoP = percentiles(joinedPredictions.map((row) => row.features.huecoTermicoD1));
    const priceP = percentiles(joinedPredictions.map((row) => row.actual));
    const baselineV4Metrics = metricsFromJoined(joinedPredictions, "predV4");

    writeCsv("folds.csv", foldRows);
    writeCsv("segments.csv", buildSegments(joinedPredictions, huecoP, priceP));
    writeCsv("correlations.csv", buildCorrelations(comparableRows, NEW_FEATURES, [...NEW_FEATURES, ...CORRELATION_BASE_FEATURES]));
    writeCsv("split_counts.csv", buildSplitCounts(modelV4));
    writeCsv("zero_importance_usage.csv", buildZeroImportanceUsage(modelV4));
    writeCsv("errors_2026-09-13_2026-09-16.csv", await buildErrorDetail(builder, factory, modelV1, modelV4));

    const ablationRows: AblationResult[] = [];
    const ablations = [
      ...INDIVIDUAL_ABLATIONS.map((feature) => ({ name: feature, remove: [feature] })),
      ...Object.entries(GROUP_ABLATIONS).map(([name, remove]) => ({ name, remove }))
    ];
    for (const [index, ablation] of ablations.entries()) {
      const featureNames = modelV4.variablesUtilizadas.filter((feature) => !ablation.remove.includes(feature));
      console.log(`[forecast-v4-diagnostics] Ablation ${index + 1}/${ablations.length}: ${ablation.name}`);
      const predictions: JoinedPrediction[] = [];
      for (const fold of folds) {
        const validationRows = completeRows(fold.validationRows, featureNames);
        const validationSet = new Set(validationRows.map((row) => row.timestampUtc));
        const trainRows = completeRows(fold.trainRows, featureNames);
        const preds = await trainAndPredict(factory, featureNames, trainRows, validationRows);
        const predByTimestamp = new Map(preds.map((pred) => [pred.timestampUtc, pred.predicted]));
        const comparable = joinedPredictions.filter((row) => validationSet.has(row.timestampUtc) && predByTimestamp.has(row.timestampUtc));
        predictions.push(
          ...comparable.map((row) => ({
            ...row,
            predV4: predByTimestamp.get(row.timestampUtc) as number
          }))
        );
      }
      const ablationMetrics = metricsFromJoined(predictions, "predV4");
      ablationRows.push({
        removed: ablation.name,
        N: predictions.length,
        MAE: ablationMetrics.MAE,
        delta_MAE_vs_v4: nullableDiff(ablationMetrics.MAE, baselineV4Metrics.MAE),
        RMSE: ablationMetrics.RMSE,
        delta_RMSE_vs_v4: nullableDiff(ablationMetrics.RMSE, baselineV4Metrics.RMSE),
        MAE_18_23: metricsFromJoined(predictions.filter((row) => row.hour >= 18 && row.hour <= 23), "predV4").MAE,
        MAE_hueco_P90: metricsFromJoined(predictions.filter((row) => row.features.huecoTermicoD1 >= huecoP.p90), "predV4").MAE,
        MAE_precio_P90: metricsFromJoined(predictions.filter((row) => row.actual >= priceP.p90), "predV4").MAE
      });
    }
    writeCsv("ablation.csv", ablationRows);

    writeJson("summary.json", {
      generatedAt: new Date().toISOString(),
      modelV1: modelSummary(modelV1),
      modelV4: modelSummary(modelV4),
      dataset: {
        fechaDesde,
        fechaHasta,
        sourceRows: dataset.rows.length,
        comparableRows: comparableRows.length,
        featureNamesInDataset: dataset.featureNames.length,
        excludedFeaturesInDataset: dataset.excludedFeatures.length
      },
      methodology: {
        readOnly: true,
        createsModels: false,
        activatesModels: false,
        changesPipeline: false,
        foldLogic: "Reconstructed from ForecastValidationService monthly walk-forward: validationIndex=2..months-1, train=all prior months, validation=current month.",
        v1Comparison: "Time-honest temporal v1 comparison retrains gradientBoostingD1 with v1 feature set on each fold train rows and evaluates exactly the same validation observations.",
        ablation: "Each ablation retrains temporary in-memory gradientBoostingD1 models without the removed feature set; no feature values are zeroed and no model is saved."
      },
      thresholds: {
        huecoTermicoD1: huecoP,
        precioReal: priceP
      },
      aggregateWalkForward: {
        v1: metricsFromJoined(joinedPredictions, "predV1"),
        v4: baselineV4Metrics
      },
      files: [
        "folds.csv",
        "segments.csv",
        "ablation.csv",
        "correlations.csv",
        "errors_2026-09-13_2026-09-16.csv",
        "split_counts.csv",
        "zero_importance_usage.csv",
        "summary.json"
      ]
    });

    console.log(`[forecast-v4-diagnostics] Done. Output: ${OUT_DIR}`);
  } finally {
    await app.close();
  }
}

function modelSummary(model: StoredModel) {
  return {
    id: model.id,
    version: model.version,
    tipo: model.tipo,
    activo: model.activo,
    fechaDesde: model.fechaDesde,
    fechaHasta: model.fechaHasta,
    variables: model.variablesUtilizadas.length,
    metricas: model.metricas,
    walkForwardMetricas: model.walkForwardMetricas
  };
}

function completeRows(rows: ForecastFeatureRow[], featureNames: string[]) {
  return rows.filter((row) => featureNames.every((feature) => isFiniteNumber(row.features[feature])));
}

function buildMonthlyFolds(rows: ForecastFeatureRow[]) {
  const months = [...new Set(rows.map((row) => monthKey(row.timestampUtc)))].sort();
  const folds: Array<{ validationMonth: string; trainRows: ForecastFeatureRow[]; validationRows: ForecastFeatureRow[] }> = [];
  for (let validationIndex = 2; validationIndex < months.length; validationIndex += 1) {
    const trainMonths = new Set(months.slice(0, validationIndex));
    const validationMonth = months[validationIndex];
    const trainRows = rows.filter((row) => trainMonths.has(monthKey(row.timestampUtc)));
    const validationRows = rows.filter((row) => monthKey(row.timestampUtc) === validationMonth);
    if (validationRows.length > 0) {
      folds.push({ validationMonth, trainRows, validationRows });
    }
  }
  return folds;
}

async function trainAndPredict(factory: ForecastModelFactory, featureNames: string[], trainRows: ForecastFeatureRow[], validationRows: ForecastFeatureRow[]) {
  const trainDataset = datasetFromRows(trainRows, featureNames);
  const validationDataset = datasetFromRows(validationRows, featureNames);
  const model = factory.create(MODEL_ID);
  await model.train(trainDataset);
  return model.predict(validationDataset);
}

function datasetFromRows(rows: ForecastFeatureRow[], featureNames: string[]): ForecastDataset {
  return {
    rows: rows.map((row) => ({
      timestampUtc: row.timestampUtc,
      date: row.date,
      datetimeLocal: row.datetimeLocal,
      target: row.target,
      features: Object.fromEntries(featureNames.map((feature) => [feature, row.features[feature]]))
    })),
    featureNames,
    excludedFeatures: [],
    metadata: {
      fechaDesde: minString(rows.map((row) => row.date ?? row.timestampUtc.slice(0, 10))),
      fechaHasta: maxString(rows.map((row) => row.date ?? row.timestampUtc.slice(0, 10))),
      totalRows: rows.length,
      targetRows: rows.length,
      trainingRows: rows.length,
      mappingVariables: featureNames.length
    }
  };
}

function joinPredictions(rows: ForecastFeatureRow[], v1Predictions: PredictionResult[], v4Predictions: PredictionResult[]): JoinedPrediction[] {
  const rowByTimestamp = new Map(rows.map((row) => [row.timestampUtc, row]));
  const v1ByTimestamp = new Map(v1Predictions.map((row) => [row.timestampUtc, row]));
  const v4ByTimestamp = new Map(v4Predictions.map((row) => [row.timestampUtc, row]));
  return [...rowByTimestamp.entries()]
    .filter(([timestamp]) => v1ByTimestamp.has(timestamp) && v4ByTimestamp.has(timestamp))
    .map(([timestamp, row]) => {
      const date = row.date ?? timestamp.slice(0, 10);
      const hour = Number((row.datetimeLocal ?? timestamp).slice(11, 13));
      return {
        timestampUtc: timestamp,
        date,
        datetimeLocal: row.datetimeLocal ?? timestamp,
        month: date.slice(0, 7),
        hour,
        weekday: Number(row.features.weekday ?? new Date(timestamp).getUTCDay()),
        actual: row.target,
        predV1: v1ByTimestamp.get(timestamp)?.predicted as number,
        predV4: v4ByTimestamp.get(timestamp)?.predicted as number,
        features: row.features
      };
    })
    .sort((left, right) => left.timestampUtc.localeCompare(right.timestampUtc));
}

function buildSegments(rows: JoinedPrediction[], huecoP: ReturnType<typeof percentiles>, priceP: ReturnType<typeof percentiles>) {
  const segments: Array<{ segment: string; rows: JoinedPrediction[] }> = [{ segment: "global", rows }];
  for (const month of [...new Set(rows.map((row) => row.month))].sort()) {
    segments.push({ segment: `month=${month}`, rows: rows.filter((row) => row.month === month) });
  }
  for (const hour of [...new Set(rows.map((row) => row.hour))].sort((left, right) => left - right)) {
    segments.push({ segment: `hour=${String(hour).padStart(2, "0")}`, rows: rows.filter((row) => row.hour === hour) });
  }
  segments.push({ segment: "hours=18-23", rows: rows.filter((row) => row.hour >= 18 && row.hour <= 23) });
  segments.push(...bucketSegments("huecoTermicoD1", rows, (row) => row.features.huecoTermicoD1, huecoP));
  segments.push(...bucketSegments("precioReal", rows, (row) => row.actual, priceP));
  return segments.map(({ segment, rows: segmentRows }) => {
    const v1 = metricsFromJoined(segmentRows, "predV1");
    const v4 = metricsFromJoined(segmentRows, "predV4");
    return {
      segment,
      N: segmentRows.length,
      MAE_v1: v1.MAE,
      MAE_v4: v4.MAE,
      delta_MAE: nullableDiff(v4.MAE, v1.MAE),
      RMSE_v1: v1.RMSE,
      RMSE_v4: v4.RMSE,
      delta_RMSE: nullableDiff(v4.RMSE, v1.RMSE),
      bias_v1: v1.bias,
      bias_v4: v4.bias
    };
  });
}

function bucketSegments(name: string, rows: JoinedPrediction[], value: (row: JoinedPrediction) => number, p: ReturnType<typeof percentiles>) {
  return [
    { segment: `${name}<P25`, rows: rows.filter((row) => value(row) < p.p25) },
    { segment: `${name}=P25-P50`, rows: rows.filter((row) => value(row) >= p.p25 && value(row) < p.p50) },
    { segment: `${name}=P50-P75`, rows: rows.filter((row) => value(row) >= p.p50 && value(row) < p.p75) },
    { segment: `${name}=P75-P90`, rows: rows.filter((row) => value(row) >= p.p75 && value(row) < p.p90) },
    { segment: `${name}>=P90`, rows: rows.filter((row) => value(row) >= p.p90) }
  ];
}

function buildCorrelations(rows: ForecastFeatureRow[], leftFeatures: string[], rightFeatures: string[]) {
  const result: Record<string, unknown>[] = [];
  const uniqueRight = [...new Set(rightFeatures)];
  for (const left of leftFeatures) {
    for (const right of uniqueRight) {
      if (left === right) {
        continue;
      }
      const pairs = rows
        .map((row) => [row.features[left], row.features[right]])
        .filter(([a, b]) => isFiniteNumber(a) && isFiniteNumber(b)) as Array<[number, number]>;
      const corr = pearson(pairs.map(([a]) => a), pairs.map(([, b]) => b));
      result.push({
        feature: left,
        compared_to: right,
        N: pairs.length,
        corr,
        abs_corr: corr === null ? null : round(Math.abs(corr)),
        abs_corr_ge_090: corr !== null && Math.abs(corr) >= 0.9,
        abs_corr_ge_095: corr !== null && Math.abs(corr) >= 0.95
      });
    }
  }
  return result;
}

async function buildErrorDetail(builder: ForecastDatasetBuilderService, factory: ForecastModelFactory, modelV1: StoredModel, modelV4: StoredModel) {
  const wantedDates = new Set(["2026-09-13", "2026-09-16"]);
  const detailFeatures = [...new Set([...modelV4.variablesUtilizadas, ...ERROR_DETAIL_FEATURES])];
  const detailDataset = await builder.buildPredictionRangeDataset({ fechaDesde: "2026-09-13", fechaHasta: "2026-09-16", featureNames: detailFeatures });
  const v1Predictions = await predictStored(factory, modelV1, await builder.buildPredictionRangeDataset({ fechaDesde: "2026-09-13", fechaHasta: "2026-09-16", featureNames: modelV1.variablesUtilizadas }));
  const v4Predictions = await predictStored(factory, modelV4, await builder.buildPredictionRangeDataset({ fechaDesde: "2026-09-13", fechaHasta: "2026-09-16", featureNames: modelV4.variablesUtilizadas }));
  const v1ByTimestamp = new Map(v1Predictions.map((row) => [row.timestampUtc, row.predicted]));
  const v4ByTimestamp = new Map(v4Predictions.map((row) => [row.timestampUtc, row.predicted]));
  return detailDataset.rows
    .filter((row) => wantedDates.has(row.date ?? "") && v1ByTimestamp.has(row.timestampUtc) && v4ByTimestamp.has(row.timestampUtc))
    .map((row) => {
      const predV1 = v1ByTimestamp.get(row.timestampUtc) as number;
      const predV4 = v4ByTimestamp.get(row.timestampUtc) as number;
      return {
        fechaHora: row.datetimeLocal ?? row.timestampUtc,
        precioReal: row.target,
        prediccionV1: predV1,
        prediccionV4: predV4,
        errorV1: round(predV1 - row.target),
        errorV4: round(predV4 - row.target),
        ...Object.fromEntries(ERROR_DETAIL_FEATURES.map((feature) => [feature, row.features[feature] ?? null]))
      };
    });
}

async function predictStored(factory: ForecastModelFactory, stored: StoredModel, dataset: ForecastDataset) {
  const model = factory.create(stored.tipo);
  await loadStored(model, stored);
  return model.predict(dataset);
}

async function loadStored(model: PredictionModel, stored: StoredModel) {
  await model.load({
    model: stored.tipo,
    trainedAt: stored.fecha,
    variables: stored.variablesUtilizadas,
    intercept: stored.intercepto,
    coefficients: stored.coeficientes,
    featureStats: stored.featureStats,
    metrics: stored.metricas
  });
}

function buildSplitCounts(model: StoredModel) {
  const counts = new Map(model.variablesUtilizadas.map((feature) => [feature, 0]));
  const treeCount = Number(model.coeficientes.__gb_treeCount ?? 0);
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const nodeCount = Number(model.coeficientes[`__gb_${treeIndex}_nodeCount`] ?? 0);
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const featureIndex = Number(model.coeficientes[`__gb_${treeIndex}_${nodeIndex}_featureIndex`] ?? -1);
      if (featureIndex >= 0) {
        const feature = model.variablesUtilizadas[featureIndex];
        counts.set(feature, (counts.get(feature) ?? 0) + 1);
      }
    }
  }
  const importanceByFeature = new Map(model.featureImportance.map((item) => [item.variable, item.importance]));
  return model.variablesUtilizadas.map((feature) => ({
    variable: feature,
    split_count: counts.get(feature) ?? 0,
    importance: importanceByFeature.get(feature) ?? model.coeficientes[feature] ?? 0
  }));
}

function buildZeroImportanceUsage(model: StoredModel) {
  return buildSplitCounts(model)
    .filter((row) => Number(row.importance) === 0 || ["season_winter", "season_autumn", "season_spring", "hidraulicaStoragePctOfMax", "festivoNacional", "ntcMoroccoImportD1", "windPressurePct"].includes(String(row.variable)))
    .map((row) => ({
      ...row,
      never_used_in_any_tree: Number(row.split_count) === 0
    }));
}

function metrics(predictions: PredictionResult[]) {
  if (predictions.length === 0) {
    return { N: 0, MAE: null, RMSE: null, bias: null, r: null };
  }
  const errors = predictions.map((row) => row.predicted - row.actual);
  return {
    N: predictions.length,
    MAE: round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length),
    RMSE: round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length)),
    bias: round(errors.reduce((sum, error) => sum + error, 0) / errors.length),
    r: pearson(predictions.map((row) => row.actual), predictions.map((row) => row.predicted))
  };
}

function metricsFromJoined(rows: JoinedPrediction[], predictionKey: "predV1" | "predV4") {
  return metrics(
    rows.map((row) => ({
      timestampUtc: row.timestampUtc,
      date: row.date,
      datetimeLocal: row.datetimeLocal,
      actual: row.actual,
      predicted: row[predictionKey],
      residual: row.actual - row[predictionKey]
    }))
  );
}

function percentiles(values: Array<number | null | undefined>) {
  const sorted = values.filter(isFiniteNumber).sort((left, right) => left - right);
  return {
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9)
  };
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) {
    return NaN;
  }
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index];
}

function pearson(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) {
    return null;
  }
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? null : round(numerator / denominator);
}

function writeCsv(fileName: string, rows: Record<string, unknown>[]) {
  const filePath = path.join(OUT_DIR, fileName);
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.join(","), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeJson(fileName: string, value: unknown) {
  fs.writeFileSync(path.join(OUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function monthKey(timestamp: string) {
  return timestamp.slice(0, 7);
}

function minString(values: Array<string | undefined>) {
  return values.filter(Boolean).sort()[0] ?? "";
}

function maxString(values: Array<string | undefined>) {
  return values.filter(Boolean).sort().at(-1) ?? "";
}

function intersectSets<T>(left: Set<T>, right: Set<T>) {
  return new Set([...left].filter((value) => right.has(value)));
}

function nullableDiff(left: number | null, right: number | null) {
  return left === null || right === null ? null : round(left - right);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
