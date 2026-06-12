import type {
  TechnicalAggregateColumnDefinition,
  TechnicalAggregateDefinition,
  TechnicalAggregateKind
} from "./types.js";

function normalizeAggregateDefinition<T>(
  definition: TechnicalAggregateDefinition<T> | TechnicalAggregateKind | null | undefined
): TechnicalAggregateDefinition<T> | null {
  if (definition === null || definition === undefined) {
    return null;
  }

  return typeof definition === "string" ? { kind: definition } : definition;
}

function readNumericValue<T>(row: T, definition: TechnicalAggregateDefinition<T>): number | null {
  if (!definition.getValue) {
    return typeof row === "number" && !Number.isNaN(row) ? row : null;
  }

  const value = definition.getValue(row);
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function aggregateSum<T>(rows: readonly T[], definition: TechnicalAggregateDefinition<T>): number {
  let total = 0;

  for (const row of rows) {
    const value = readNumericValue(row, definition);
    if (value === null) {
      continue;
    }

    total += value;
  }

  return total;
}

function aggregateCount<T>(rows: readonly T[], definition: TechnicalAggregateDefinition<T>): number {
  if (!definition.getValue) {
    return rows.length;
  }

  let total = 0;

  for (const row of rows) {
    if (readNumericValue(row, definition) !== null) {
      total += 1;
    }
  }

  return total;
}

function aggregateAverage<T>(rows: readonly T[], definition: TechnicalAggregateDefinition<T>): number | null {
  let total = 0;
  let count = 0;

  for (const row of rows) {
    const value = readNumericValue(row, definition);
    if (value === null) {
      continue;
    }

    total += value;
    count += 1;
  }

  return count === 0 ? null : total / count;
}

function aggregateMinMax<T>(
  rows: readonly T[],
  definition: TechnicalAggregateDefinition<T>,
  mode: "min" | "max"
): number | null {
  let result: number | null = null;

  for (const row of rows) {
    const value = readNumericValue(row, definition);
    if (value === null) {
      continue;
    }

    if (result === null) {
      result = value;
      continue;
    }

    if (mode === "min" && value < result) {
      result = value;
    }

    if (mode === "max" && value > result) {
      result = value;
    }
  }

  return result;
}

export function aggregateRows<T>(
  rows: readonly T[],
  definition: TechnicalAggregateDefinition<T> | TechnicalAggregateKind | null | undefined
): unknown {
  const normalized = normalizeAggregateDefinition(definition);
  if (!normalized) {
    return undefined;
  }

  switch (normalized.kind) {
    case "sum":
      return aggregateSum(rows, normalized);
    case "avg":
      return aggregateAverage(rows, normalized);
    case "count":
      return aggregateCount(rows, normalized);
    case "min":
      return aggregateMinMax(rows, normalized, "min");
    case "max":
      return aggregateMinMax(rows, normalized, "max");
    case "custom":
      return normalized.calculate ? normalized.calculate([...rows]) : undefined;
  }
}

export function aggregateColumns<T, TColumn extends TechnicalAggregateColumnDefinition<T>>(
  rows: readonly T[],
  definitions: readonly TColumn[]
): Record<string, unknown> {
  return Object.fromEntries(
    definitions.flatMap((definition) =>
      definition.aggregate === null || definition.aggregate === undefined
        ? []
        : [[definition.id, aggregateRows(rows, definition.aggregate)]]
    )
  );
}

export function buildAggregateRow<T, TColumn extends TechnicalAggregateColumnDefinition<T>>(
  rows: readonly T[],
  columns: readonly TColumn[]
): Record<string, unknown> {
  return aggregateColumns(rows, columns);
}
