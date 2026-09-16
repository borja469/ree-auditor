import { BadRequestException } from "@nestjs/common";
import { ForecastEvaluationService } from "./evaluation.service";
import { EvaluationMetrics, ForecastDataset, PredictionModel, PredictionResult, TrainedModelSnapshot } from "./prediction-model.interface";

const TREE_COUNT = 450;
const LEARNING_RATE = 0.045;
const MAX_DEPTH = 3;
const MIN_LEAF_SIZE = 20;
const THRESHOLD_BUCKETS = 40;
const GB_PREFIX = "__gb";

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

export class GradientBoostingModel implements PredictionModel {
  readonly name: string;
  private featureNames: string[] = [];
  private trees: TreeNode[] = [];
  private baseline = 0;
  private trainedAt: string | null = null;
  private metrics: EvaluationMetrics = { r: null, mae: null, rmse: null };
  private featureImportances = new Map<string, number>();

  constructor(
    private readonly evaluationService: ForecastEvaluationService,
    modelName = "gradientBoostingD1"
  ) {
    this.name = modelName;
  }

  async train(dataset: ForecastDataset): Promise<TrainedModelSnapshot> {
    validateDataset(dataset);
    this.featureNames = dataset.featureNames;
    const rows = dataset.rows.map((row) => ({
      features: this.featureNames.map((feature) => row.features[feature]),
      target: row.target
    }));
    this.baseline = mean(rows.map((row) => row.target));
    const predictions = new Array(rows.length).fill(this.baseline);
    const thresholds = buildThresholds(rows, this.featureNames.length);
    const importanceCounts = new Array(this.featureNames.length).fill(0);
    this.trees = [];

    for (let treeIndex = 0; treeIndex < TREE_COUNT; treeIndex += 1) {
      const residualRows = rows.map((row, index) => ({ features: row.features, target: row.target - predictions[index] }));
      const tree = buildTree(residualRows, 0, thresholds, importanceCounts);
      this.trees.push(tree);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        predictions[rowIndex] += LEARNING_RATE * predictTree(tree, rows[rowIndex].features);
      }
    }

    this.featureImportances = normalizeImportances(this.featureNames, importanceCounts);
    this.trainedAt = new Date().toISOString();
    this.metrics = await this.evaluate(dataset);
    return this.save();
  }

  async predict(dataset: ForecastDataset): Promise<PredictionResult[]> {
    if (this.trees.length === 0) {
      throw new BadRequestException(`El modelo ${this.name} no esta entrenado.`);
    }
    return dataset.rows.map((row) => {
      const features = this.featureNames.map((feature) => row.features[feature]);
      const predicted = this.trees.reduce((result, tree) => result + LEARNING_RATE * predictTree(tree, features), this.baseline);
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
      coefficients: encodeBoosting(this.trees, this.featureNames, this.featureImportances),
      metrics: this.metrics
    };
  }

  async load(snapshot: TrainedModelSnapshot): Promise<void> {
    this.featureNames = snapshot.variables;
    this.baseline = snapshot.intercept;
    this.featureImportances = new Map(
      this.featureNames.map((feature) => [feature, typeof snapshot.coefficients[feature] === "number" ? (snapshot.coefficients[feature] as number) : 0])
    );
    this.trees = decodeBoosting(snapshot.coefficients);
    this.trainedAt = snapshot.trainedAt;
    this.metrics = snapshot.metrics;
  }
}

function validateDataset(dataset: ForecastDataset) {
  if (dataset.featureNames.length === 0) {
    throw new BadRequestException("No hay variables explicativas disponibles para entrenar el modelo.");
  }
  if (dataset.rows.length < MIN_LEAF_SIZE * 4) {
    throw new BadRequestException(`No hay observaciones suficientes para entrenar gradientBoostingD1. Minimo requerido: ${MIN_LEAF_SIZE * 4}.`);
  }
}

function buildThresholds(rows: TrainingRow[], featureCount: number) {
  return Array.from({ length: featureCount }, (_, featureIndex) => candidateThresholds(rows, featureIndex));
}

function buildTree(rows: TrainingRow[], depth: number, thresholds: number[][], importanceCounts: number[]): TreeNode {
  const value = mean(rows.map((row) => row.target));
  if (depth >= MAX_DEPTH || rows.length < MIN_LEAF_SIZE * 2) {
    return { value };
  }

  const split = findBestSplit(rows, thresholds);
  if (!split) {
    return { value };
  }
  importanceCounts[split.featureIndex] += split.gain;
  return {
    value,
    featureIndex: split.featureIndex,
    threshold: split.threshold,
    left: buildTree(split.leftRows, depth + 1, thresholds, importanceCounts),
    right: buildTree(split.rightRows, depth + 1, thresholds, importanceCounts)
  };
}

function findBestSplit(rows: TrainingRow[], thresholds: number[][]) {
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

  for (let featureIndex = 0; featureIndex < thresholds.length; featureIndex += 1) {
    for (const threshold of thresholds[featureIndex]) {
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
  for (let bucket = 1; bucket < THRESHOLD_BUCKETS; bucket += 1) {
    const index = Math.min(values.length - 2, Math.max(0, Math.floor((values.length * bucket) / THRESHOLD_BUCKETS)));
    const threshold = round((values[index] + values[index + 1]) / 2);
    if (!thresholds.includes(threshold)) {
      thresholds.push(threshold);
    }
  }
  return thresholds;
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

function encodeBoosting(trees: TreeNode[], featureNames: string[], featureImportances: Map<string, number>): Record<string, number> {
  const coefficients: Record<string, number> = Object.fromEntries(featureNames.map((feature) => [feature, round(featureImportances.get(feature) ?? 0)]));
  coefficients[`${GB_PREFIX}_treeCount`] = trees.length;
  coefficients[`${GB_PREFIX}_learningRate`] = LEARNING_RATE;
  for (const [treeIndex, tree] of trees.entries()) {
    const nodes = flattenTree(tree);
    coefficients[`${GB_PREFIX}_${treeIndex}_nodeCount`] = nodes.length;
    for (const [nodeIndex, node] of nodes.entries()) {
      const prefix = `${GB_PREFIX}_${treeIndex}_${nodeIndex}`;
      coefficients[`${prefix}_featureIndex`] = node.featureIndex;
      coefficients[`${prefix}_threshold`] = node.threshold;
      coefficients[`${prefix}_left`] = node.left;
      coefficients[`${prefix}_right`] = node.right;
      coefficients[`${prefix}_value`] = round(node.value);
    }
  }
  return coefficients;
}

function decodeBoosting(coefficients: Record<string, unknown>): TreeNode[] {
  const treeCount = numberValue(coefficients[`${GB_PREFIX}_treeCount`]);
  if (treeCount <= 0) {
    throw new BadRequestException("El artefacto gradientBoostingD1 no contiene arboles entrenados.");
  }
  return Array.from({ length: treeCount }, (_, treeIndex) => {
    const nodeCount = numberValue(coefficients[`${GB_PREFIX}_${treeIndex}_nodeCount`]);
    const nodes = Array.from({ length: nodeCount }, (_, nodeIndex): EncodedNode => {
      const prefix = `${GB_PREFIX}_${treeIndex}_${nodeIndex}`;
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

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : value;
}
