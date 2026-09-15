import { BadRequestException } from "@nestjs/common";
import { EvaluationMetrics, ForecastDataset, PredictionModel, PredictionResult, TrainedModelSnapshot } from "./prediction-model.interface";
import { ForecastEvaluationService } from "./evaluation.service";

const TREE_COUNT = 24;
const MAX_DEPTH = 5;
const MIN_LEAF_SIZE = 24;
const FEATURE_SAMPLE_RATIO = 0.55;
const ROW_SAMPLE_RATIO = 0.7;
const THRESHOLD_BUCKETS = 8;
const RF_PREFIX = "__rf";

type TreeNode = {
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  value: number;
};

type EncodedNode = {
  featureIndex: number;
  threshold: number;
  left: number;
  right: number;
  value: number;
};

type TrainingRow = {
  features: number[];
  target: number;
};

export class RandomForestModel implements PredictionModel {
  readonly name = "randomForest";
  private featureNames: string[] = [];
  private trees: TreeNode[] = [];
  private baseline = 0;
  private trainedAt: string | null = null;
  private metrics: EvaluationMetrics = { r: null, mae: null, rmse: null };
  private featureImportances = new Map<string, number>();

  constructor(private readonly evaluationService: ForecastEvaluationService) {}

  async train(dataset: ForecastDataset): Promise<TrainedModelSnapshot> {
    validateDataset(dataset);
    this.featureNames = dataset.featureNames;
    const rows = dataset.rows.map((row) => ({
      features: this.featureNames.map((feature) => row.features[feature]),
      target: row.target
    }));
    this.baseline = mean(rows.map((row) => row.target));
    const importanceCounts = new Array(this.featureNames.length).fill(0);
    this.trees = [];

    for (let treeIndex = 0; treeIndex < TREE_COUNT; treeIndex += 1) {
      const rng = mulberry32(0x9e3779b9 + treeIndex * 2654435761);
      const sample = bootstrapRows(rows, rng);
      const tree = buildTree(sample, 0, rng, this.featureNames.length, importanceCounts);
      this.trees.push(tree);
    }

    this.featureImportances = normalizeImportances(this.featureNames, importanceCounts);
    this.trainedAt = new Date().toISOString();
    this.metrics = await this.evaluate(dataset);
    return this.save();
  }

  async predict(dataset: ForecastDataset): Promise<PredictionResult[]> {
    if (this.trees.length === 0) {
      throw new BadRequestException("El modelo randomForest no esta entrenado.");
    }
    return dataset.rows.map((row) => {
      const features = this.featureNames.map((feature) => row.features[feature]);
      const predicted = mean(this.trees.map((tree) => predictTree(tree, features)));
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

  async evaluate(dataset: ForecastDataset) {
    return this.evaluationService.evaluate(await this.predict(dataset));
  }

  async save(): Promise<TrainedModelSnapshot> {
    return {
      model: this.name,
      trainedAt: this.trainedAt,
      variables: this.featureNames,
      intercept: round(this.baseline),
      coefficients: encodeForest(this.trees, this.featureNames, this.featureImportances),
      metrics: this.metrics
    };
  }

  async load(snapshot: TrainedModelSnapshot): Promise<void> {
    this.featureNames = snapshot.variables;
    this.baseline = snapshot.intercept;
    this.featureImportances = new Map(
      this.featureNames.map((feature) => [feature, typeof snapshot.coefficients[feature] === "number" ? (snapshot.coefficients[feature] as number) : 0])
    );
    this.trees = decodeForest(snapshot.coefficients);
    this.trainedAt = snapshot.trainedAt;
    this.metrics = snapshot.metrics;
  }
}

function validateDataset(dataset: ForecastDataset) {
  if (dataset.featureNames.length === 0) {
    throw new BadRequestException("No hay variables explicativas disponibles para entrenar el modelo.");
  }
  if (dataset.rows.length < MIN_LEAF_SIZE * 2) {
    throw new BadRequestException(`No hay observaciones suficientes para entrenar randomForest. Minimo requerido: ${MIN_LEAF_SIZE * 2}.`);
  }
}

function bootstrapRows(rows: TrainingRow[], rng: () => number) {
  const sampleSize = Math.max(MIN_LEAF_SIZE * 2, Math.floor(rows.length * ROW_SAMPLE_RATIO));
  return Array.from({ length: sampleSize }, () => rows[Math.floor(rng() * rows.length)]);
}

function buildTree(rows: TrainingRow[], depth: number, rng: () => number, featureCount: number, importanceCounts: number[]): TreeNode {
  const value = mean(rows.map((row) => row.target));
  if (depth >= MAX_DEPTH || rows.length < MIN_LEAF_SIZE * 2) {
    return { value };
  }

  const split = findBestSplit(rows, sampleFeatureIndexes(featureCount, rng));
  if (!split) {
    return { value };
  }
  importanceCounts[split.featureIndex] += split.gain;
  return {
    value,
    featureIndex: split.featureIndex,
    threshold: split.threshold,
    left: buildTree(split.leftRows, depth + 1, rng, featureCount, importanceCounts),
    right: buildTree(split.rightRows, depth + 1, rng, featureCount, importanceCounts)
  };
}

function findBestSplit(rows: TrainingRow[], featureIndexes: number[]) {
  const parentError = squaredError(rows);
  let best:
    | {
        featureIndex: number;
        threshold: number;
        gain: number;
        leftRows: TrainingRow[];
        rightRows: TrainingRow[];
      }
    | null = null;

  for (const featureIndex of featureIndexes) {
    for (const threshold of candidateThresholds(rows, featureIndex)) {
      const leftRows: TrainingRow[] = [];
      const rightRows: TrainingRow[] = [];
      for (const row of rows) {
        if (row.features[featureIndex] <= threshold) {
          leftRows.push(row);
        } else {
          rightRows.push(row);
        }
      }
      if (leftRows.length < MIN_LEAF_SIZE || rightRows.length < MIN_LEAF_SIZE) {
        continue;
      }
      const gain = parentError - squaredError(leftRows) - squaredError(rightRows);
      if (gain > 1e-9 && (!best || gain > best.gain)) {
        best = { featureIndex, threshold, gain, leftRows, rightRows };
      }
    }
  }

  return best;
}

function candidateThresholds(rows: TrainingRow[], featureIndex: number) {
  const values = [...new Set(rows.map((row) => row.features[featureIndex]).filter(Number.isFinite))].sort((left, right) => left - right);
  if (values.length <= 1) {
    return [];
  }
  const thresholds: number[] = [];
  for (let bucket = 1; bucket <= THRESHOLD_BUCKETS; bucket += 1) {
    const index = Math.min(values.length - 2, Math.max(0, Math.floor((values.length - 1) * (bucket / (THRESHOLD_BUCKETS + 1)))));
    const threshold = round((values[index] + values[index + 1]) / 2);
    if (!thresholds.includes(threshold)) {
      thresholds.push(threshold);
    }
  }
  return thresholds;
}

function sampleFeatureIndexes(featureCount: number, rng: () => number) {
  const sampleSize = Math.max(1, Math.ceil(featureCount * FEATURE_SAMPLE_RATIO));
  return Array.from({ length: featureCount }, (_, index) => index)
    .sort(() => rng() - 0.5)
    .slice(0, sampleSize);
}

function squaredError(rows: TrainingRow[]) {
  const rowMean = mean(rows.map((row) => row.target));
  return rows.reduce((sum, row) => sum + (row.target - rowMean) ** 2, 0);
}

function predictTree(tree: TreeNode, features: number[]): number {
  let current = tree;
  while (current.left && current.right && current.featureIndex !== undefined && current.threshold !== undefined) {
    current = features[current.featureIndex] <= current.threshold ? current.left : current.right;
  }
  return current.value;
}

function encodeForest(trees: TreeNode[], featureNames: string[], featureImportances: Map<string, number>): Record<string, number> {
  const coefficients: Record<string, number> = Object.fromEntries(featureNames.map((feature) => [feature, round(featureImportances.get(feature) ?? 0)]));
  coefficients[`${RF_PREFIX}_treeCount`] = trees.length;
  for (const [treeIndex, tree] of trees.entries()) {
    const nodes = flattenTree(tree);
    coefficients[`${RF_PREFIX}_${treeIndex}_nodeCount`] = nodes.length;
    for (const [nodeIndex, node] of nodes.entries()) {
      const prefix = `${RF_PREFIX}_${treeIndex}_${nodeIndex}`;
      coefficients[`${prefix}_featureIndex`] = node.featureIndex;
      coefficients[`${prefix}_threshold`] = node.threshold;
      coefficients[`${prefix}_left`] = node.left;
      coefficients[`${prefix}_right`] = node.right;
      coefficients[`${prefix}_value`] = round(node.value);
    }
  }
  return coefficients;
}

function decodeForest(coefficients: Record<string, unknown>): TreeNode[] {
  const treeCount = numberValue(coefficients[`${RF_PREFIX}_treeCount`]);
  if (treeCount <= 0) {
    throw new BadRequestException("El artefacto randomForest no contiene arboles entrenados.");
  }
  return Array.from({ length: treeCount }, (_, treeIndex) => {
    const nodeCount = numberValue(coefficients[`${RF_PREFIX}_${treeIndex}_nodeCount`]);
    const nodes = Array.from({ length: nodeCount }, (_, nodeIndex): EncodedNode => {
      const prefix = `${RF_PREFIX}_${treeIndex}_${nodeIndex}`;
      return {
        featureIndex: numberValue(coefficients[`${prefix}_featureIndex`]),
        threshold: numberValue(coefficients[`${prefix}_threshold`]),
        left: numberValue(coefficients[`${prefix}_left`]),
        right: numberValue(coefficients[`${prefix}_right`]),
        value: numberValue(coefficients[`${prefix}_value`])
      };
    });
    return inflateTree(nodes, 0);
  });
}

function flattenTree(root: TreeNode) {
  const nodes: EncodedNode[] = [];
  const visit = (node: TreeNode): number => {
    const index = nodes.length;
    nodes.push({ featureIndex: -1, threshold: 0, left: -1, right: -1, value: node.value });
    if (node.left && node.right && node.featureIndex !== undefined && node.threshold !== undefined) {
      const left = visit(node.left);
      const right = visit(node.right);
      nodes[index] = { featureIndex: node.featureIndex, threshold: node.threshold, left, right, value: node.value };
    }
    return index;
  };
  visit(root);
  return nodes;
}

function inflateTree(nodes: EncodedNode[], index: number): TreeNode {
  const node = nodes[index];
  if (!node || node.featureIndex < 0 || node.left < 0 || node.right < 0) {
    return { value: node?.value ?? 0 };
  }
  return {
    featureIndex: node.featureIndex,
    threshold: node.threshold,
    value: node.value,
    left: inflateTree(nodes, node.left),
    right: inflateTree(nodes, node.right)
  };
}

function normalizeImportances(featureNames: string[], importanceCounts: number[]) {
  const total = importanceCounts.reduce((sum, value) => sum + value, 0);
  return new Map(featureNames.map((feature, index) => [feature, total === 0 ? 0 : importanceCounts[index] / total]));
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;
}
