import type { TechnicalSortDefinition, TechnicalSortDirection, TechnicalSortState } from "./types.js";

type SortMode = "number" | "date" | "boolean" | "string" | "other";

type SortEntry<T> = {
  row: T;
  index: number;
  raw: unknown;
  value: unknown;
};

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value);
}

function normalizeNumericValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDateValue(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return undefined;
    }

    if (isDateString(text)) {
      const time = Date.parse(text);
      return Number.isFinite(time) ? time : undefined;
    }
  }

  return undefined;
}

function inferSortMode(values: readonly unknown[], explicitType?: TechnicalSortDefinition<unknown>["type"]): SortMode {
  if (explicitType === "number") {
    return "number";
  }

  if (explicitType === "date") {
    return "date";
  }

  if (explicitType === "boolean") {
    return "boolean";
  }

  if (explicitType === "text") {
    return "string";
  }

  const presentValues = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (presentValues.length === 0) {
    return "string";
  }

  if (presentValues.every((value) => typeof value === "boolean")) {
    return "boolean";
  }

  if (presentValues.every((value) => normalizeNumericValue(value) !== undefined)) {
    return "number";
  }

  if (presentValues.every((value) => typeof value === "string" && isDateString(value.trim()) && normalizeDateValue(value) !== undefined)) {
    return "date";
  }

  if (presentValues.every((value) => value instanceof Date && normalizeDateValue(value) !== undefined)) {
    return "date";
  }

  return "string";
}

function compareStrings(left: unknown, right: unknown): number {
  return String(left ?? "").localeCompare(String(right ?? ""), "es", { numeric: true, sensitivity: "base" });
}

function compareEntries<T>(left: SortEntry<T>, right: SortEntry<T>, mode: SortMode, direction: TechnicalSortDirection): number {
  if (mode === "boolean") {
    const leftMissing = left.raw === null || left.raw === undefined;
    const rightMissing = right.raw === null || right.raw === undefined;

    if (leftMissing && rightMissing) {
      return left.index - right.index;
    }

    if (leftMissing) {
      return 1;
    }

    if (rightMissing) {
      return -1;
    }

    const comparison = Number(Boolean(left.value)) - Number(Boolean(right.value));
    if (comparison !== 0) {
      return direction === "asc" ? comparison : -comparison;
    }

    return left.index - right.index;
  }

  if (mode === "number") {
    const comparison = (left.value as number) - (right.value as number);
    if (comparison !== 0) {
      return direction === "asc" ? comparison : -comparison;
    }

    return left.index - right.index;
  }

  if (mode === "date") {
    const comparison = (left.value as number) - (right.value as number);
    if (comparison !== 0) {
      return direction === "asc" ? comparison : -comparison;
    }

    return left.index - right.index;
  }

  const comparison = compareStrings(left.value, right.value);
  if (comparison !== 0) {
    return direction === "asc" ? comparison : -comparison;
  }

  return left.index - right.index;
}

export function buildSortState(columnId?: string, direction?: TechnicalSortDirection): TechnicalSortState | null {
  if (!columnId || !direction) {
    return null;
  }

  return { columnId, direction };
}

export function clearSort(): null {
  return null;
}

export function applySort<T>(
  rows: readonly T[],
  definitions: readonly TechnicalSortDefinition<T>[],
  sortState: TechnicalSortState | null | undefined
): T[] {
  if (!sortState) {
    return [...rows];
  }

  const definition = definitions.find((entry) => entry.id === sortState.columnId);
  if (!definition) {
    return [...rows];
  }

  const rawValues = rows.map((row) => definition.getValue(row));
  const mode = inferSortMode(rawValues, definition.type);

  const entries = rows.map<SortEntry<T>>((row, index) => ({
    row,
    index,
    raw: definition.getValue(row),
    value:
      mode === "number"
        ? normalizeNumericValue(definition.getValue(row)) ?? Number.NEGATIVE_INFINITY
        : mode === "date"
          ? normalizeDateValue(definition.getValue(row)) ?? 0
          : mode === "boolean"
            ? Boolean(definition.getValue(row))
            : definition.getValue(row)
  }));

  return entries.sort((left, right) => compareEntries(left, right, mode, sortState.direction)).map((entry) => entry.row);
}
