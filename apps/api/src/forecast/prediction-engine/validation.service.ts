import { Injectable } from "@nestjs/common";
import { ForecastDataset, EvaluationMetrics } from "./prediction-model.interface";
import { ForecastModelFactory } from "./model-factory";

export type WalkForwardMetrics = EvaluationMetrics & {
  folds: number;
};

@Injectable()
export class ForecastValidationService {
  constructor(private readonly modelFactory: ForecastModelFactory) {}

  async walkForward(dataset: ForecastDataset, modelId: string): Promise<WalkForwardMetrics> {
    const months = uniqueMonths(dataset.rows.map((row) => row.timestampUtc));
    if (months.length < 3) {
      return { r: null, mae: null, rmse: null, folds: 0 };
    }

    const foldMetrics: EvaluationMetrics[] = [];
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
        foldMetrics.push(await model.evaluate({ ...dataset, rows: validationRows, metadata: { ...dataset.metadata, trainingRows: validationRows.length } }));
      } catch {
        continue;
      }
    }

    return {
      r: averageMetric(foldMetrics.map((metric) => metric.r)),
      mae: averageMetric(foldMetrics.map((metric) => metric.mae)),
      rmse: averageMetric(foldMetrics.map((metric) => metric.rmse)),
      folds: foldMetrics.length
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
