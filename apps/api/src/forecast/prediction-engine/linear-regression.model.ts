import { BadRequestException } from "@nestjs/common";
import { EvaluationMetrics, ForecastDataset, ForecastFeatureStats, PredictionModel, PredictionResult, TrainedModelSnapshot } from "./prediction-model.interface";
import { ForecastEvaluationService } from "./evaluation.service";

const RIDGE_LAMBDA = 1e-3;

export class LinearRegressionModel implements PredictionModel {
  readonly name = "linear";
  private intercept = 0;
  private coefficients = new Map<string, number>();
  private featureStats: ForecastFeatureStats = {};
  private trainedAt: string | null = null;
  private metrics: EvaluationMetrics = { r: null, mae: null, rmse: null };

  constructor(private readonly evaluationService: ForecastEvaluationService) {}

  async train(dataset: ForecastDataset): Promise<TrainedModelSnapshot> {
    validateDataset(dataset);
    const featureNames = dataset.featureNames;
    this.featureStats = calculateFeatureStats(dataset);
    const designMatrix = dataset.rows.map((row) => [1, ...featureNames.map((feature) => normalize(row.features[feature], this.featureStats[feature]))]);
    const target = dataset.rows.map((row) => row.target);
    const beta = solveNormalEquation(designMatrix, target);

    this.intercept = beta[0];
    this.coefficients = new Map(featureNames.map((feature, index) => [feature, beta[index + 1]]));
    this.trainedAt = new Date().toISOString();
    this.metrics = await this.evaluate(dataset);
    return this.save();
  }

  async predict(dataset: ForecastDataset): Promise<PredictionResult[]> {
    if (this.coefficients.size === 0) {
      throw new BadRequestException("El modelo linear no esta entrenado.");
    }
    return dataset.rows.map((row) => {
      const predicted = dataset.featureNames.reduce(
        (sum, feature) => sum + (this.coefficients.get(feature) ?? 0) * normalize(row.features[feature], this.featureStats[feature]),
        this.intercept
      );
      return {
        timestampUtc: row.timestampUtc,
        date: row.date,
        datetimeLocal: row.datetimeLocal,
        actual: row.target,
        predicted: round(predicted),
        residual: round(row.target - predicted)
      };
    });
  }

  async evaluate(dataset: ForecastDataset): Promise<EvaluationMetrics> {
    return this.evaluationService.evaluate(await this.predict(dataset));
  }

  async save(): Promise<TrainedModelSnapshot> {
    return {
      model: this.name,
      trainedAt: this.trainedAt,
      variables: [...this.coefficients.keys()],
      intercept: round(this.intercept),
      coefficients: Object.fromEntries([...this.coefficients.entries()].map(([feature, value]) => [feature, round(value)])),
      featureStats: Object.fromEntries(
        Object.entries(this.featureStats).map(([feature, stats]) => [
          feature,
          {
            mean: round(stats.mean),
            stdDev: round(stats.stdDev)
          }
        ])
      ),
      metrics: this.metrics
    };
  }

  async load(snapshot: TrainedModelSnapshot): Promise<void> {
    this.intercept = snapshot.intercept;
    this.coefficients = new Map(Object.entries(snapshot.coefficients));
    this.featureStats = snapshot.featureStats ?? Object.fromEntries(snapshot.variables.map((feature) => [feature, { mean: 0, stdDev: 1 }]));
    this.trainedAt = snapshot.trainedAt;
    this.metrics = snapshot.metrics;
  }
}

function validateDataset(dataset: ForecastDataset) {
  if (dataset.featureNames.length === 0) {
    throw new BadRequestException("No hay variables explicativas disponibles para entrenar el modelo.");
  }
  if (dataset.rows.length < dataset.featureNames.length + 2) {
    throw new BadRequestException("No hay observaciones suficientes para entrenar una regresion lineal multiple.");
  }
}

function solveNormalEquation(x: number[][], y: number[]) {
  const xTransposed = transpose(x);
  const xtx = multiplyMatrices(xTransposed, x);
  for (let index = 1; index < xtx.length; index += 1) {
    xtx[index][index] += RIDGE_LAMBDA;
  }
  const xty = multiplyMatrixVector(xTransposed, y);
  return solveLinearSystem(xtx, xty);
}

function calculateFeatureStats(dataset: ForecastDataset): ForecastFeatureStats {
  return Object.fromEntries(
    dataset.featureNames.map((feature) => {
      const values = dataset.rows.map((row) => row.features[feature]);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);
      return [feature, { mean, stdDev: stdDev === 0 ? 1 : stdDev }];
    })
  );
}

function normalize(value: number, stats?: { mean: number; stdDev: number }) {
  if (!stats || stats.stdDev === 0) {
    return value;
  }
  return (value - stats.mean) / stats.stdDev;
}

function transpose(matrix: number[][]) {
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]));
}

function multiplyMatrices(left: number[][], right: number[][]) {
  return left.map((leftRow) =>
    right[0].map((_, columnIndex) => leftRow.reduce((sum, value, rowIndex) => sum + value * right[rowIndex][columnIndex], 0))
  );
}

function multiplyMatrixVector(matrix: number[][], vector: number[]) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let maxRow = pivotIndex;
    for (let row = pivotIndex + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivotIndex]) > Math.abs(augmented[maxRow][pivotIndex])) {
        maxRow = row;
      }
    }
    [augmented[pivotIndex], augmented[maxRow]] = [augmented[maxRow], augmented[pivotIndex]];

    const pivot = augmented[pivotIndex][pivotIndex];
    if (Math.abs(pivot) < 1e-12) {
      throw new BadRequestException("No se pudo resolver la regresion lineal por colinealidad extrema.");
    }

    for (let column = pivotIndex; column <= size; column += 1) {
      augmented[pivotIndex][column] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivotIndex) {
        continue;
      }
      const factor = augmented[row][pivotIndex];
      for (let column = pivotIndex; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivotIndex][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;
}
