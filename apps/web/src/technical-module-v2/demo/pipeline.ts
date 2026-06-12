import { applyFilters, buildFilterState, getFilterOptions } from "../filters/engine.js";
import { applyPreset, getVisibleColumns, toggleColumn } from "../columns/engine.js";
import { applySort, clearSort } from "../sort/engine.js";
import type { TechnicalColumnVisibilityState } from "../columns/types.js";
import type { TechnicalSortState } from "../sort/types.js";
import {
  clearTechnicalModuleDemoSnapshot,
  loadTechnicalModuleDemoSnapshot,
  saveTechnicalModuleDemoSnapshot,
  createTechnicalModuleDemoBackend
} from "./storage.js";
import {
  technicalModuleDemoColumns,
  technicalModuleDemoFilters,
  technicalModuleDemoRows,
  technicalModuleDemoSorts
} from "./data.js";
import type {
  TechnicalModuleDemoRuntime,
  TechnicalModuleDemoSnapshot,
  TechnicalModuleDemoView,
  TechnicalModuleDemoStorageBackend
} from "./types.js";

const DEFAULT_SNAPSHOT: TechnicalModuleDemoSnapshot = {
  preset: "basic",
  hiddenColumns: [],
  filters: buildFilterState(technicalModuleDemoFilters),
  sort: null
};

function createSnapshotState(snapshot?: Partial<TechnicalModuleDemoSnapshot>): TechnicalModuleDemoSnapshot {
  return {
    preset: snapshot?.preset === "advanced" ? "advanced" : "basic",
    hiddenColumns: Array.isArray(snapshot?.hiddenColumns)
      ? snapshot!.hiddenColumns.filter((entry): entry is string => typeof entry === "string")
      : [],
    filters: {
      ...buildFilterState(technicalModuleDemoFilters),
      ...(snapshot?.filters ?? {})
    },
    sort: snapshot?.sort ?? null
  };
}

function buildColumnState(snapshot: TechnicalModuleDemoSnapshot): TechnicalColumnVisibilityState {
  return snapshot.hiddenColumns.reduce(
    (state, columnId) => toggleColumn(technicalModuleDemoColumns, state, columnId),
    applyPreset(technicalModuleDemoColumns, snapshot.preset)
  );
}

function buildRenderedRows(
  rows: Array<(typeof technicalModuleDemoRows)[number]>,
  visibleColumns: typeof technicalModuleDemoColumns
): Array<Record<string, string>> {
  return rows.map((row) =>
    Object.fromEntries(
      visibleColumns.map((column) => {
        const value = row[column.id as keyof typeof row];
        return [column.id, String(value)];
      })
    )
  );
}

export function runTechnicalModuleDemoPipeline(snapshot: TechnicalModuleDemoSnapshot): TechnicalModuleDemoView {
  const columnState = buildColumnState(snapshot);
  const visibleColumns = getVisibleColumns(technicalModuleDemoColumns, columnState);
  const filteredRows = applyFilters(technicalModuleDemoRows, technicalModuleDemoFilters, snapshot.filters);
  const sortedRows = applySort(filteredRows, technicalModuleDemoSorts, snapshot.sort);

  return {
    snapshot,
    columnState,
    visibleColumns,
    filteredRows,
    sortedRows,
    renderedRows: buildRenderedRows(sortedRows, visibleColumns),
    enumOptions: getFilterOptions(technicalModuleDemoRows, technicalModuleDemoFilters[1])
  };
}

export function createTechnicalModuleDemoRuntime(options?: {
  backend?: TechnicalModuleDemoStorageBackend;
  storageKey?: string;
  initialSnapshot?: Partial<TechnicalModuleDemoSnapshot>;
}): TechnicalModuleDemoRuntime {
  const backend = options?.backend ?? createTechnicalModuleDemoBackend();
  const storageKey = options?.storageKey ?? "technical-module-v2-demo";
  let snapshot = createSnapshotState(
    loadTechnicalModuleDemoSnapshot(backend, storageKey) ?? options?.initialSnapshot ?? DEFAULT_SNAPSHOT
  );

  const persist = () => {
    saveTechnicalModuleDemoSnapshot(backend, snapshot, storageKey);
  };

  const setSnapshot = (next: TechnicalModuleDemoSnapshot) => {
    snapshot = createSnapshotState(next);
    persist();
  };

  return {
    get snapshot() {
      return snapshot;
    },
    get view() {
      return runTechnicalModuleDemoPipeline(snapshot);
    },
    setPreset(preset) {
      setSnapshot({ ...snapshot, preset });
    },
    toggleColumn(columnId) {
      setSnapshot({
        ...snapshot,
        hiddenColumns: snapshot.hiddenColumns.includes(columnId)
          ? snapshot.hiddenColumns.filter((entry) => entry !== columnId)
          : [...snapshot.hiddenColumns, columnId]
      });
    },
    setFilter(filterId, value) {
      setSnapshot({
        ...snapshot,
        filters: {
          ...snapshot.filters,
          [filterId]: value
        }
      });
    },
    clearFilters() {
      setSnapshot({
        ...snapshot,
        filters: buildFilterState(technicalModuleDemoFilters)
      });
    },
    setSort(sort: TechnicalSortState | null) {
      setSnapshot({
        ...snapshot,
        sort
      });
    },
    clearSort() {
      setSnapshot({
        ...snapshot,
        sort: clearSort()
      });
    },
    persist,
    reload() {
      const loaded = loadTechnicalModuleDemoSnapshot(backend, storageKey);
      if (loaded) {
        snapshot = createSnapshotState(loaded);
      } else {
        snapshot = createSnapshotState(DEFAULT_SNAPSHOT);
      }
    }
  };
}

export function resetTechnicalModuleDemoStorage(
  backend: TechnicalModuleDemoStorageBackend,
  storageKey?: string
): void {
  clearTechnicalModuleDemoSnapshot(backend, storageKey);
}
