import type {
  TechnicalDateFilterValue,
  TechnicalFilterDefinition,
  TechnicalFilterOption,
  TechnicalFilterPrimitive,
  TechnicalFilterState,
  TechnicalFilterType,
  TechnicalFilterValue,
  TechnicalNumberFilterValue
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: TechnicalFilterValue): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "number") {
    return Number.isNaN(value);
  }

  if (typeof value === "boolean") {
    return false;
  }

  if (isRecord(value)) {
    return Object.values(value).every((entry) => entry === null || entry === undefined || entry === "");
  }

  return true;
}

function normalizePrimitive(value: unknown): TechnicalFilterPrimitive | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return null;
}

function normalizeBooleanPrimitive(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : String(value ?? "").trim().toLowerCase();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toDateTime(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  return null;
}

function normalizeDateFilter(value: TechnicalFilterValue): TechnicalDateFilterValue {
  if (isRecord(value) && ("from" in value || "to" in value)) {
    const candidate = value as Partial<TechnicalDateFilterValue>;
    return {
      from: candidate.from instanceof Date || typeof candidate.from === "string" ? candidate.from : null,
      to: candidate.to instanceof Date || typeof candidate.to === "string" ? candidate.to : null
    };
  }

  if (value instanceof Date || typeof value === "string") {
    return { from: value, to: value };
  }

  return {};
}

function normalizeNumberFilter(value: TechnicalFilterValue): TechnicalNumberFilterValue {
  if (isRecord(value) && ("min" in value || "max" in value)) {
    const candidate = value as Partial<TechnicalNumberFilterValue>;
    return {
      min: normalizeNumber(candidate.min),
      max: normalizeNumber(candidate.max)
    };
  }

  const numericValue = normalizeNumber(value);
  if (numericValue === null) {
    return {};
  }

  return {
    min: numericValue,
    max: numericValue
  };
}

function normalizeEnumSelection(value: TechnicalFilterValue): TechnicalFilterPrimitive[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePrimitive(entry)).filter((entry): entry is TechnicalFilterPrimitive => entry !== null);
  }

  const primitive = normalizePrimitive(value);
  return primitive === null ? [] : [primitive];
}

function isBooleanSelection(value: TechnicalFilterValue): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return null;
}

function matchesText(rowValue: unknown, filterValue: string): boolean {
  return normalizeText(rowValue).includes(normalizeText(filterValue));
}

function matchesNumber(rowValue: unknown, filterValue: TechnicalNumberFilterValue): boolean {
  const numericRowValue = normalizeNumber(rowValue);
  if (numericRowValue === null) {
    return false;
  }

  if (filterValue.min !== undefined && filterValue.min !== null && numericRowValue < filterValue.min) {
    return false;
  }

  if (filterValue.max !== undefined && filterValue.max !== null && numericRowValue > filterValue.max) {
    return false;
  }

  return true;
}

function matchesDate(rowValue: unknown, filterValue: TechnicalDateFilterValue): boolean {
  const rowTime = toDateTime(rowValue);
  if (rowTime === null) {
    return false;
  }

  const fromTime = toDateTime(filterValue.from);
  const toTime = toDateTime(filterValue.to);

  if (fromTime !== null && rowTime < fromTime) {
    return false;
  }

  if (toTime !== null && rowTime > toTime) {
    return false;
  }

  return true;
}

function matchesEnum(rowValue: unknown, filterValue: TechnicalFilterValue): boolean {
  const selectedValues = normalizeEnumSelection(filterValue);
  if (selectedValues.length === 0) {
    return true;
  }

  const rowPrimitive = normalizePrimitive(rowValue);
  return rowPrimitive !== null && selectedValues.includes(rowPrimitive);
}

function matchesBoolean(rowValue: unknown, filterValue: TechnicalFilterValue): boolean {
  const selection = isBooleanSelection(filterValue);
  if (selection === null) {
    return true;
  }

  if (typeof rowValue === "boolean") {
    return rowValue === selection;
  }

  if (typeof rowValue === "string") {
    const normalized = rowValue.toLowerCase();
    if (normalized === "true" || normalized === "false") {
      return (normalized === "true") === selection;
    }
  }

  return false;
}

export function buildFilterState<T>(
  definitions: readonly TechnicalFilterDefinition<T>[],
  initialState?: Partial<TechnicalFilterState>
): TechnicalFilterState {
  const state: TechnicalFilterState = {};

  for (const definition of definitions) {
    state[definition.id] = initialState?.[definition.id] ?? null;
  }

  return state;
}

export function clearFilters<T>(definitions: readonly TechnicalFilterDefinition<T>[]): TechnicalFilterState {
  return buildFilterState(definitions);
}

export function getFilterOptions<T>(
  rows: readonly T[],
  definition: TechnicalFilterDefinition<T>
): TechnicalFilterOption[] {
  if (definition.type !== "enum" && definition.type !== "boolean") {
    return [];
  }

  const uniqueValues = new Map<TechnicalFilterPrimitive, string>();

  for (const row of rows) {
    const rawValue = definition.getValue(row);
    const primitive = definition.type === "boolean" ? normalizeBooleanPrimitive(rawValue) : normalizePrimitive(rawValue);
    if (primitive === null) {
      continue;
    }

    if (!uniqueValues.has(primitive)) {
      uniqueValues.set(primitive, String(primitive));
    }
  }

  return [...uniqueValues.entries()]
    .sort(([left], [right]) => {
      if (typeof left === "boolean" && typeof right === "boolean") {
        return Number(left) - Number(right);
      }

      return String(left).localeCompare(String(right), "es", { sensitivity: "base" });
    })
    .map(([value, label]) => ({ value, label }));
}

export function applyFilters<T>(
  rows: readonly T[],
  definitions: readonly TechnicalFilterDefinition<T>[],
  filterState: TechnicalFilterState
): T[] {
  return rows.filter((row) =>
    definitions.every((definition) => {
      const rawFilterValue = filterState[definition.id];
      if (isEmptyValue(rawFilterValue)) {
        return true;
      }

      const rowValue = definition.getValue(row);

      switch (definition.type) {
        case "text":
          return typeof rawFilterValue === "string" ? matchesText(rowValue, rawFilterValue) : true;
        case "number":
          return matchesNumber(rowValue, normalizeNumberFilter(rawFilterValue));
        case "date":
          return matchesDate(rowValue, normalizeDateFilter(rawFilterValue));
        case "enum":
          return matchesEnum(rowValue, rawFilterValue);
        case "boolean":
          return matchesBoolean(rowValue, rawFilterValue);
        default:
          return true;
      }
    })
  );
}
