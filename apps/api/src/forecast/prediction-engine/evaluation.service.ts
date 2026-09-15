import { Injectable } from "@nestjs/common";
import { EvaluationMetrics, PredictionResult } from "./prediction-model.interface";

@Injectable()
export class ForecastEvaluationService {
  evaluate(predictions: PredictionResult[]): EvaluationMetrics {
    if (predictions.length === 0) {
      return { r: null, mae: null, rmse: null };
    }

    const absoluteError = predictions.reduce((sum, row) => sum + Math.abs(row.residual), 0);
    const squaredError = predictions.reduce((sum, row) => sum + row.residual ** 2, 0);

    return {
      r: roundNullable(pearson(predictions.map((row) => row.actual), predictions.map((row) => row.predicted))),
      mae: round(absoluteError / predictions.length),
      rmse: round(Math.sqrt(squaredError / predictions.length))
    };
  }
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
