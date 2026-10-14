import { Injectable } from "@nestjs/common";
import {
  EvaluationMetrics,
  ForecastDataset,
  ForecastFeatureRow,
  ForecastSegmentKey,
  ForecastSegmentMetrics,
  ForecastSegmentedMetrics,
  PredictionResult,
  WalkForwardMetrics
} from "./prediction-model.interface";
import { ForecastModelFactory } from "./model-factory";

const SEGMENT_KEYS: ForecastSegmentKey[] = ["all", "solar", "night", "evening"];

@Injectable()
export class ForecastValidationService {
  constructor(private readonly modelFactory: ForecastModelFactory) {}

  async walkForward(dataset: ForecastDataset, modelId: string): Promise<WalkForwardMetrics> {
    const months = uniqueMonths(dataset.rows.map((row) => row.timestampUtc));
    if (months.length < 3) {
      return {
        r: null,
        mae: null,
        rmse: null,
        folds: 0,
        segments: emptySegmentedMetrics(),
        baselines: {
          sameHourLag24: emptySegmentedMetrics(),
          sameHourRolling7d: emptySegmentedMetrics()
        },
        hybrid: emptySegmentedMetrics()
      };
    }

    const foldMetrics: EvaluationMetrics[] = [];
    const validationPredictions: PredictionResult[] = [];
    const validationRowsForBaselines: ForecastFeatureRow[] = [];
    for (let validationIndex = 2; validationIndex < months.length; validationIndex += 1) {
      const trainMonths = new Set(months.slice(0, validationIndex));
      const validationMonth = months[validationIndex];
      const trainRows = dataset.rows.filter((row) => trainMonths.has(monthKey(row.timestampUtc)));
      const validationRows = dataset.rows.filter((row) => monthKey(row.timestampUtc) === validationMonth);
      if (trainRows.length < dataset.featureNames.length + 2 || validationRows.length === 0) {
        continue;
      }
      try {
        const model = this.modelFactory.create(modelId);
        await model.train({ ...dataset, rows: trainRows, metadata: { ...dataset.metadata, trainingRows: trainRows.length } });
        const validationDataset = { ...dataset, rows: validationRows, metadata: { ...dataset.metadata, trainingRows: validationRows.length } };
        const predictions = await model.predict(validationDataset);
        foldMetrics.push(evaluatePredictions(predictions));
        validationPredictions.push(...predictions);
        validationRowsForBaselines.push(...validationRows);
      } catch {
        continue;
      }
    }

    return {
      r: averageMetric(foldMetrics.map((metric) => metric.r)),
      mae: averageMetric(foldMetrics.map((metric) => metric.mae)),
      rmse: averageMetric(foldMetrics.map((metric) => metric.rmse)),
      folds: foldMetrics.length,
      segments: evaluateSegments(validationPredictions),
      baselines: evaluateBaselines(dataset.rows, validationRowsForBaselines),
      hybrid: evaluateHybridLag24BySegment(dataset.rows, validationPredictions)
    };
  }
}

function uniqueMonths(timestamps: string[]) {
  return [...new Set(timestamps.map(monthKey))].sort();
}

function monthKey(timestamp: string) {
  return timestamp.slice(0, 7);
}

function averageMetric(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 1_000_000) / 1_000_000;
}

export function evaluateSegments(predictions: PredictionResult[]): ForecastSegmentedMetrics {
  return Object.fromEntries(
    SEGMENT_KEYS.map((segment) => [segment, evaluatePredictions(predictions.filter((row) => belongsToSegment(segment, localHour(row))))])
  ) as ForecastSegmentedMetrics;
}

export function evaluateBaselines(allRows: ForecastFeatureRow[], validationRows: ForecastFeatureRow[]) {
  const actualByLocalHour = new Map<string, number>();
  for (const row of allRows) {
    const date = localDate(row);
    const hour = localHour(row);
    if (date && hour !== null && Number.isFinite(row.target)) {
      actualByLocalHour.set(localHourKey(date, hour), row.target);
    }
  }

  return {
    sameHourLag24: evaluateSegments(buildBaselinePredictions(validationRows, (row) => {
      const date = localDate(row);
      const hour = localHour(row);
      return date && hour !== null ? actualByLocalHour.get(localHourKey(shiftDate(date, -1), hour)) : undefined;
    })),
    sameHourRolling7d: evaluateSegments(buildBaselinePredictions(validationRows, (row) => {
      const date = localDate(row);
      const hour = localHour(row);
      if (!date || hour === null) {
        return undefined;
      }
      const values = Array.from({ length: 7 }, (_, index) => actualByLocalHour.get(localHourKey(shiftDate(date, -(index + 1)), hour))).filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value)
      );
      return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
    }))
  };
}

export function evaluateHybridLag24BySegment(allRows: ForecastFeatureRow[], modelPredictions: PredictionResult[]): ForecastSegmentedMetrics {
  const actualByLocalHour = buildActualByLocalHour(allRows);
  const hybridPredictions = modelPredictions
    .map((row) => {
      const hour = localHour(row);
      const date = localDate(row);
      if (!date || hour === null) {
        return null;
      }
      const lag24 = actualByLocalHour.get(localHourKey(shiftDate(date, -1), hour));
      const shouldUseLag24 = belongsToSegment("night", hour) || belongsToSegment("evening", hour);
      const predicted = shouldUseLag24 ? lag24 : row.predicted;
      if (typeof predicted !== "number" || !Number.isFinite(predicted)) {
        return null;
      }
      const result: PredictionResult = {
        timestampUtc: row.timestampUtc,
        actual: row.actual,
        predicted,
        residual: row.actual - predicted
      };
      if (row.date) {
        result.date = row.date;
      }
      if (row.datetimeLocal) {
        result.datetimeLocal = row.datetimeLocal;
      }
      return result;
    })
    .filter((row): row is PredictionResult => row !== null);

  return evaluateSegments(hybridPredictions);
}

function buildBaselinePredictions(validationRows: ForecastFeatureRow[], predict: (row: ForecastFeatureRow) => number | undefined): PredictionResult[] {
  return validationRows
    .map((row) => {
      const predicted = predict(row);
      if (typeof predicted !== "number" || !Number.isFinite(predicted)) {
        return null;
      }
      const result: PredictionResult = {
        timestampUtc: row.timestampUtc,
        actual: row.target,
        predicted,
        residual: row.target - predicted
      };
      if (row.date) {
        result.date = row.date;
      }
      if (row.datetimeLocal) {
        result.datetimeLocal = row.datetimeLocal;
      }
      return result;
    })
    .filter((row): row is PredictionResult => row !== null);
}

function buildActualByLocalHour(rows: ForecastFeatureRow[]) {
  const actualByLocalHour = new Map<string, number>();
  for (const row of rows) {
    const date = localDate(row);
    const hour = localHour(row);
    if (date && hour !== null && Number.isFinite(row.target)) {
      actualByLocalHour.set(localHourKey(date, hour), row.target);
    }
  }
  return actualByLocalHour;
}

function evaluatePredictions(predictions: PredictionResult[]): ForecastSegmentMetrics {
  if (predictions.length === 0) {
    return { r: null, mae: null, rmse: null, count: 0 };
  }
  const absoluteError = predictions.reduce((sum, row) => sum + Math.abs(row.residual), 0);
  const squaredError = predictions.reduce((sum, row) => sum + row.residual ** 2, 0);
  return {
    r: roundNullable(pearson(predictions.map((row) => row.actual), predictions.map((row) => row.predicted))),
    mae: round(absoluteError / predictions.length),
    rmse: round(Math.sqrt(squaredError / predictions.length)),
    count: predictions.length
  };
}

function emptySegmentedMetrics(): ForecastSegmentedMetrics {
  return Object.fromEntries(SEGMENT_KEYS.map((segment) => [segment, { r: null, mae: null, rmse: null, count: 0 }])) as ForecastSegmentedMetrics;
}

function belongsToSegment(segment: ForecastSegmentKey, hour: number | null) {
  if (segment === "all") {
    return true;
  }
  if (hour === null) {
    return false;
  }
  if (segment === "solar") {
    return hour >= 10 && hour <= 16;
  }
  if (segment === "night") {
    return hour >= 0 && hour <= 7;
  }
  return hour >= 18 && hour <= 22;
}

function localDate(row: { date?: string; datetimeLocal?: string; timestampUtc: string }) {
  return row.date ?? row.datetimeLocal?.slice(0, 10) ?? row.timestampUtc.slice(0, 10);
}

function localHour(row: { datetimeLocal?: string; timestampUtc: string }) {
  const text = row.datetimeLocal?.slice(11, 13) ?? row.timestampUtc.slice(11, 13);
  const hour = Number(text);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function localHourKey(date: string, hour: number) {
  return `${date}|${String(hour).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
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
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundNullable(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : round(value);
}
