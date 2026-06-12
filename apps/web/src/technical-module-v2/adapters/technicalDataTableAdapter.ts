import { applyFilters, getFilterOptions } from "../filters/engine.js";
import type { TechnicalFilterDefinition, TechnicalFilterOption, TechnicalFilterState } from "../filters/types.js";
import { applyPreset, getVisibleColumns } from "../columns/engine.js";
import type { TechnicalColumnDefinition, TechnicalColumnVisibilityState } from "../columns/types.js";
import { applySort } from "../sort/engine.js";
import type { TechnicalSortDefinition, TechnicalSortState } from "../sort/types.js";
import { normalizeTechnicalPreferencesState } from "../persistence/state.js";
import type { TechnicalPreferencesState } from "../types.js";
import type { TechnicalPreferencesStorageAdapter } from "../persistence/types.js";

export type TechnicalDataMode = "basic" | "advanced";

export type TechnicalDataTableAdapterColumn<T> = {
  id: string;
  label: string;
  help?: string;
  width: number;
  align?: "left" | "center" | "right";
  type?: "text" | "number" | "date";
  sticky?: boolean;
  visibility?: TechnicalDataMode;
  advanced?: boolean;
  heatmap?: boolean;
  heatmapTone?: "signed" | "risk";
  numericTone?: "signed" | "zero-danger" | "neutral";
  filter?: "text" | "number" | "select";
  defaultHidden?: boolean;
  expectedEmpty?: (row: T) => boolean;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => unknown;
  exportValue?: (row: T) => string | number | null | undefined;
};

export type TechnicalDataTableAdapterState = {
  mode: TechnicalDataMode;
  search: string;
  filters: Record<string, string>;
  sort?: TechnicalSortState;
  hiddenColumns: string[];
};

export type TechnicalDataTableAdapterPreferences = {
  key: string;
  storage: TechnicalPreferencesStorageAdapter;
  version: number;
  defaultState?: Partial<TechnicalPreferencesState>;
};

export type TechnicalDataTableAdapterInput<T> = {
  rows: T[];
  columns: Array<TechnicalDataTableAdapterColumn<T>>;
  state?: Partial<TechnicalDataTableAdapterState>;
  preferences?: TechnicalDataTableAdapterPreferences;
  showModeSelector?: boolean;
};

export type TechnicalDataTableAdapterView<T> = {
  state: TechnicalDataTableAdapterState;
  v2State: {
    preset: TechnicalColumnVisibilityState["preset"];
    overrides: TechnicalColumnVisibilityState["overrides"];
    hiddenColumns: string[];
  };
  v2Columns: Array<TechnicalColumnDefinition & { sourceId: string; sourceDefaultHidden?: boolean }>;
  activeColumns: Array<TechnicalDataTableAdapterColumn<T>>;
  visibleColumns: Array<TechnicalColumnDefinition & { sourceId: string; sourceDefaultHidden?: boolean }>;
  filterState: TechnicalFilterState;
  filterOptions: Record<string, TechnicalFilterOption[]>;
  filteredRows: T[];
  sortedRows: T[];
  searchRows: T[];
  persist: () => void;
  reload: () => TechnicalDataTableAdapterView<T>;
};

function technicalColumnVisibility<T>(column: TechnicalDataTableAdapterColumn<T>): TechnicalDataMode {
  return column.visibility ?? (column.advanced ? "advanced" : "basic");
}

function buildTechnicalPresetHiddenColumns<T>(columns: Array<TechnicalDataTableAdapterColumn<T>>, mode: TechnicalDataMode): Set<string> {
  if (mode === "advanced") {
    return new Set();
  }

  return new Set(columns.filter((column) => technicalColumnVisibility(column) === "advanced").map((column) => column.id));
}

function normalizeState<T>(
  columns: Array<TechnicalDataTableAdapterColumn<T>>,
  input?: Partial<TechnicalDataTableAdapterState>,
  preferences?: TechnicalDataTableAdapterPreferences,
  showModeSelector = true
): TechnicalDataTableAdapterState {
  const defaultMode: TechnicalDataMode = showModeSelector ? "basic" : "advanced";
  const loadedPreferences = preferences ? preferences.storage.load(preferences.key) : null;
  const normalizedPreferences = loadedPreferences ? normalizeTechnicalPreferencesState(loadedPreferences, preferences?.defaultState) : null;
  const initialMode = showModeSelector ? input?.mode ?? normalizedPreferences?.preset ?? defaultMode : "advanced";
  const initialHiddenColumns =
    input?.hiddenColumns ??
    normalizedPreferences?.hiddenColumns ??
    [...buildTechnicalPresetHiddenColumns(columns, initialMode)];

  const hiddenColumns = [...new Set(initialHiddenColumns)].filter((columnId) => columns.some((column) => column.id === columnId));

  return {
    mode: initialMode,
    search: input?.search ?? "",
    filters: {
      ...(normalizedPreferences?.filters ?? {}),
      ...(input?.filters ?? {})
    },
    sort:
      input?.sort ??
      (normalizedPreferences?.sort
        ? {
            columnId: normalizedPreferences.sort.id,
            direction: normalizedPreferences.sort.direction
          }
        : undefined),
    hiddenColumns
  };
}

function buildTechnicalColumnDefinitions<T>(columns: Array<TechnicalDataTableAdapterColumn<T>>): Array<TechnicalColumnDefinition & { sourceId: string; sourceDefaultHidden?: boolean }> {
  return columns.map((column) => ({
    id: column.id,
    label: column.label,
    presets: technicalColumnVisibility(column) === "advanced" ? ["advanced"] : ["basic", "advanced"],
    filterType: column.filter === "number" ? "number" : column.filter === "select" ? "enum" : "text",
    sourceId: column.id,
    sourceDefaultHidden: Boolean(column.defaultHidden)
  }));
}

function buildTechnicalFilterDefinitions<T>(
  columns: Array<TechnicalDataTableAdapterColumn<T>>,
  visibleColumns: Array<TechnicalDataTableAdapterColumn<T>>
): Array<TechnicalFilterDefinition<T>> {
  return visibleColumns.map((column) => ({
    id: column.id,
    type: column.filter === "number" ? "number" : column.filter === "select" ? "enum" : "text",
    getValue: (row: T) => column.value(row)
  }));
}

function buildTechnicalFilterState<T>(
  columns: Array<TechnicalDataTableAdapterColumn<T>>,
  state: TechnicalDataTableAdapterState
): TechnicalFilterState {
  const nextState: TechnicalFilterState = {};

  for (const column of columns) {
    if (column.filter === "number") {
      const min = state.filters[`${column.id}:min`];
      const max = state.filters[`${column.id}:max`];
      nextState[column.id] =
        min !== undefined || max !== undefined
          ? {
              min: min !== undefined && min !== "" ? Number(min) : undefined,
              max: max !== undefined && max !== "" ? Number(max) : undefined
            }
          : null;
      continue;
    }

    nextState[column.id] = state.filters[column.id] ?? null;
  }

  return nextState;
}

function buildSearchRows<T>(rows: T[], columns: Array<TechnicalDataTableAdapterColumn<T>>, search: string): T[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return [...rows];
  }

  return rows.filter((row) =>
    columns.some((column) => {
      const text = column.value(row);
      return String(text ?? "").toLowerCase().includes(normalizedSearch);
    })
  );
}

function buildVisibilityState<T>(
  columns: Array<TechnicalDataTableAdapterColumn<T>>,
  state: TechnicalDataTableAdapterState
): TechnicalColumnVisibilityState {
  const preset = state.mode;
  const baseHidden = buildTechnicalPresetHiddenColumns(columns, preset);
  const technicalColumns = buildTechnicalColumnDefinitions(columns);
  const visibleByPreset = new Set(
    getVisibleColumns(technicalColumns, applyPreset(technicalColumns, preset)).map((column) => column.sourceId)
  );
  const overrides: Record<string, "visible" | "hidden"> = {};

  for (const column of columns) {
    const hiddenNow = state.hiddenColumns.includes(column.id);
    const visibleNow = !hiddenNow;
    const visibleByMode = visibleByPreset.has(column.id);
    const hiddenByMode = baseHidden.has(column.id);

    if (hiddenNow && visibleByMode) {
      overrides[column.id] = "hidden";
      continue;
    }

    if (visibleNow && hiddenByMode) {
      overrides[column.id] = "visible";
    }
  }

  return {
    preset,
    overrides
  };
}

function buildV2Columns<T>(columns: Array<TechnicalDataTableAdapterColumn<T>>): Array<TechnicalColumnDefinition & { sourceId: string; sourceDefaultHidden?: boolean }> {
  return buildTechnicalColumnDefinitions(columns);
}

function buildFilterOptions<T>(rows: T[], columns: Array<TechnicalDataTableAdapterColumn<T>>) {
  const options: Record<string, TechnicalFilterOption[]> = {};
  for (const column of columns) {
    if (column.filter !== "select") {
      continue;
    }

    options[column.id] = getFilterOptions(rows, {
      id: column.id,
      type: "enum",
      getValue: (row) => column.value(row)
    });
  }

  return options;
}

export function createTechnicalDataTableAdapter<T>(
  input: TechnicalDataTableAdapterInput<T>
): TechnicalDataTableAdapterView<T> {
  const state = normalizeState(input.columns, input.state, input.preferences, input.showModeSelector ?? true);
  const v2Columns = buildV2Columns(input.columns);
  const v2State = buildVisibilityState(input.columns, state);
  const visibleColumns = getVisibleColumns(v2Columns, v2State);
  const visibleColumnIds = new Set(visibleColumns.map((column) => column.sourceId));
  const activeColumns = input.columns.filter((column) => visibleColumnIds.has(column.id));
  const filterDefinitions = buildTechnicalFilterDefinitions(input.columns, activeColumns);
  const filterState = buildTechnicalFilterState(input.columns, state);
  const filteredRows = applyFilters(input.rows, filterDefinitions, filterState);
  const searchRows = buildSearchRows(filteredRows, activeColumns, state.search);
  const sortDefinitions = activeColumns.map<TechnicalSortDefinition<T>>((column) => ({
    id: column.id,
    type: column.type,
    getValue: (row) => column.value(row)
  }));
  const sortedRows = applySort(searchRows, sortDefinitions, state.sort);
  const filterOptions = buildFilterOptions(input.rows, activeColumns);

  const persist = () => {
    if (!input.preferences) {
      return;
    }

    input.preferences.storage.save(input.preferences.key, {
      preset: state.mode,
      hiddenColumns: state.hiddenColumns,
      columnOrder: input.columns.map((column) => column.id),
      filters: state.filters,
      sort: state.sort
        ? {
            id: state.sort.columnId,
            direction: state.sort.direction
          }
        : undefined,
      expandedGroups: [],
      density: "regular",
      columnWidths: {}
    });
  };

  return {
    state,
    v2State: {
      preset: v2State.preset,
      overrides: v2State.overrides,
      hiddenColumns: state.hiddenColumns
    },
    v2Columns,
    activeColumns,
    visibleColumns,
    filterState,
    filterOptions,
    filteredRows,
    sortedRows,
    searchRows,
    persist,
    reload: () => createTechnicalDataTableAdapter(input)
  };
}
