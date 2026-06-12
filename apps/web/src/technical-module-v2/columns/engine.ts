import type {
  TechnicalColumnDefinition,
  TechnicalColumnPresetName,
  TechnicalColumnVisibilityOverride,
  TechnicalColumnVisibilityState
} from "./types.js";

function normalizeColumns<T extends TechnicalColumnDefinition>(columns: readonly T[]): T[] {
  return [...columns];
}

function buildColumnMap<T extends TechnicalColumnDefinition>(columns: readonly T[]): Map<string, T> {
  return new Map(columns.map((column) => [column.id, column]));
}

function normalizeOverrides(
  columns: readonly TechnicalColumnDefinition[],
  overrides: Record<string, TechnicalColumnVisibilityOverride> | undefined
): Record<string, TechnicalColumnVisibilityOverride> {
  if (!overrides) {
    return {};
  }

  const columnIds = new Set(columns.map((column) => column.id));
  return Object.fromEntries(
    Object.entries(overrides).flatMap(([columnId, visibility]) =>
      columnIds.has(columnId) && (visibility === "visible" || visibility === "hidden") ? [[columnId, visibility]] : []
    )
  );
}

function createState(
  preset: TechnicalColumnPresetName,
  overrides: Record<string, TechnicalColumnVisibilityOverride> = {}
): TechnicalColumnVisibilityState {
  return {
    preset,
    overrides: { ...overrides }
  };
}

function isVisibleByPreset(column: TechnicalColumnDefinition, preset: TechnicalColumnPresetName): boolean {
  const presets = column.presets ?? [];
  if (presets.length > 0) {
    return presets.includes(preset);
  }

  return true;
}

function isColumnVisible(
  column: TechnicalColumnDefinition,
  state: TechnicalColumnVisibilityState
): boolean {
  const override = state.overrides[column.id];
  if (override === "visible") {
    return true;
  }

  if (override === "hidden") {
    return false;
  }

  if (column.hiddenByDefault) {
    return false;
  }

  return isVisibleByPreset(column, state.preset);
}

export function getVisibleColumns<T extends TechnicalColumnDefinition>(
  columns: readonly T[],
  state: TechnicalColumnVisibilityState
): T[] {
  return normalizeColumns(columns).filter((column) => isColumnVisible(column, state));
}

export function applyPreset<T extends TechnicalColumnDefinition>(
  columns: readonly T[],
  preset: TechnicalColumnPresetName,
  currentState?: TechnicalColumnVisibilityState | null
): TechnicalColumnVisibilityState {
  const normalizedColumns = normalizeColumns(columns);
  const preservedOverrides = normalizeOverrides(normalizedColumns, currentState?.overrides);

  return createState(preset, preservedOverrides);
}

export function toggleColumn<T extends TechnicalColumnDefinition>(
  columns: readonly T[],
  currentState: TechnicalColumnVisibilityState | null | undefined,
  columnId: string
): TechnicalColumnVisibilityState {
  const normalizedColumns = normalizeColumns(columns);
  const columnMap = buildColumnMap(normalizedColumns);
  const column = columnMap.get(columnId);
  const state = currentState
    ? createState(currentState.preset, normalizeOverrides(normalizedColumns, currentState.overrides))
    : createState("basic");

  if (!column) {
    return state;
  }

  const currentlyVisible = isColumnVisible(column, state);
  const nextOverrides = { ...state.overrides };

  if (currentlyVisible) {
    nextOverrides[columnId] = "hidden";
  } else {
    nextOverrides[columnId] = "visible";
  }

  return createState(state.preset, nextOverrides);
}

export function resetToPreset<T extends TechnicalColumnDefinition>(
  columns: readonly T[],
  preset: TechnicalColumnPresetName
): TechnicalColumnVisibilityState {
  void columns;
  return createState(preset, {});
}
