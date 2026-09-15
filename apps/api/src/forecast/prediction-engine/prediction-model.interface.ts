export type ForecastFeatureRow = {
  timestampUtc: string;
  date?: string;
  datetimeLocal?: string;
  target: number;
  features: Record<string, number>;
};

export type ForecastDataset = {
  rows: ForecastFeatureRow[];
  featureNames: string[];
  excludedFeatures: Array<{
    variable: string;
    reason: string;
    coveragePct: number;
  }>;
  metadata: {
    fechaDesde: string;
    fechaHasta: string;
    totalRows: number;
    targetRows: number;
    trainingRows: number;
    mappingVariables: number;
  };
};

export type PredictionResult = {
  timestampUtc: string;
  date?: string;
  datetimeLocal?: string;
  actual: number;
  predicted: number;
  residual: number;
};

export type EvaluationMetrics = {
  r: number | null;
  mae: number | null;
  rmse: number | null;
};

export type ForecastFeatureStats = Record<
  string,
  {
    mean: number;
    stdDev: number;
  }
>;

export type TrainedModelSnapshot = {
  model: string;
  trainedAt: string | null;
  variables: string[];
  intercept: number;
  coefficients: Record<string, number>;
  featureStats?: ForecastFeatureStats;
  metrics: EvaluationMetrics;
};

export type ForecastModelArtifact = TrainedModelSnapshot & {
  featureImportance?: Array<{
    variable: string;
    importance: number;
  }>;
};

export interface PredictionModel {
  readonly name: string;
  train(dataset: ForecastDataset): Promise<TrainedModelSnapshot>;
  predict(dataset: ForecastDataset): Promise<PredictionResult[]>;
  evaluate(dataset: ForecastDataset): Promise<EvaluationMetrics>;
  save(): Promise<TrainedModelSnapshot>;
  load(snapshot: TrainedModelSnapshot): Promise<void>;
}
