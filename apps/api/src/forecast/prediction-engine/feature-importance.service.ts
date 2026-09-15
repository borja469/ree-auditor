import { Injectable } from "@nestjs/common";
import { ForecastDataset } from "./prediction-model.interface";

@Injectable()
export class ForecastFeatureImportanceService {
  calculate(dataset: ForecastDataset, coefficients: Record<string, number>) {
    const raw = dataset.featureNames.map((variable) => ({
      variable,
      rawImportance: Math.abs(coefficients[variable] ?? 0)
    }));
    const total = raw.reduce((sum, item) => sum + item.rawImportance, 0);
    return raw
      .map((item) => ({
        variable: item.variable,
        importance: total === 0 ? 0 : round(item.rawImportance / total)
      }))
      .sort((left, right) => right.importance - left.importance);
  }
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
