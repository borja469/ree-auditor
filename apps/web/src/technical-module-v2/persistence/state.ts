import type { TechnicalPreferencesState, TechnicalSortDirection, TechnicalDensity, TechnicalPreset } from "../types.js";

const DEFAULT_PREFERENCES_STATE: TechnicalPreferencesState = {
  preset: "basic",
  hiddenColumns: [],
  columnOrder: [],
  filters: {},
  expandedGroups: [],
  density: "regular"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toFilterRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => (typeof entry === "string" ? [[key, entry]] : []))
  );
}

function isSortDirection(value: unknown): value is TechnicalSortDirection {
  return value === "asc" || value === "desc";
}

function isPreset(value: unknown): value is TechnicalPreset {
  return value === "basic" || value === "advanced";
}

function isDensity(value: unknown): value is TechnicalDensity {
  return value === "compact" || value === "regular";
}

function toColumnWidths(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const widths = Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (typeof entry !== "number" || Number.isNaN(entry) || !Number.isFinite(entry)) {
        return [];
      }

      return [[key, entry]];
    })
  );

  return Object.keys(widths).length > 0 ? widths : undefined;
}

export function normalizeTechnicalPreferencesState(
  value: Partial<TechnicalPreferencesState> | null | undefined,
  fallback?: Partial<TechnicalPreferencesState>
): TechnicalPreferencesState {
  const source = value ?? {};
  const defaults = fallback ?? {};

  const sortValue = source.sort ?? defaults.sort;
  const densityValue = source.density ?? defaults.density ?? DEFAULT_PREFERENCES_STATE.density;
  const presetValue = source.preset ?? defaults.preset ?? DEFAULT_PREFERENCES_STATE.preset;

  return {
    preset: isPreset(presetValue) ? presetValue : DEFAULT_PREFERENCES_STATE.preset,
    hiddenColumns: toStringArray(source.hiddenColumns ?? defaults.hiddenColumns),
    columnOrder: toStringArray(source.columnOrder ?? defaults.columnOrder),
    filters: toFilterRecord(source.filters ?? defaults.filters),
    sort:
      isRecord(sortValue) && typeof sortValue.id === "string" && isSortDirection(sortValue.direction)
        ? {
            id: sortValue.id,
            direction: sortValue.direction
          }
        : undefined,
    expandedGroups: toStringArray(source.expandedGroups ?? defaults.expandedGroups),
    density: isDensity(densityValue) ? densityValue : DEFAULT_PREFERENCES_STATE.density,
    columnWidths: toColumnWidths(source.columnWidths ?? defaults.columnWidths)
  };
}

export function createDefaultTechnicalPreferencesState(
  overrides?: Partial<TechnicalPreferencesState>
): TechnicalPreferencesState {
  return normalizeTechnicalPreferencesState(overrides, DEFAULT_PREFERENCES_STATE);
}
