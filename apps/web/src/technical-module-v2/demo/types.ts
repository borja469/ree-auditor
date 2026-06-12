import type { TechnicalColumnDefinition, TechnicalColumnVisibilityState } from "../columns/types.js";
import type { TechnicalFilterDefinition, TechnicalFilterOption, TechnicalFilterState } from "../filters/types.js";
import type { TechnicalSortDefinition, TechnicalSortState } from "../sort/types.js";
import type { TechnicalPreferencesStorageBackend } from "../persistence/types.js";

export type TechnicalModuleDemoRow = {
  id: number;
  name: string;
  region: string;
  status: "OK" | "WARN" | "FAIL";
  amount: number;
  active: boolean;
  day: string;
};

export type TechnicalModuleDemoSnapshot = {
  preset: TechnicalColumnVisibilityState["preset"];
  hiddenColumns: string[];
  filters: TechnicalFilterState;
  sort: TechnicalSortState | null;
};

export type TechnicalModuleDemoView = {
  snapshot: TechnicalModuleDemoSnapshot;
  columnState: TechnicalColumnVisibilityState;
  visibleColumns: TechnicalColumnDefinition[];
  filteredRows: TechnicalModuleDemoRow[];
  sortedRows: TechnicalModuleDemoRow[];
  renderedRows: Array<Record<string, string>>;
  enumOptions: TechnicalFilterOption[];
};

export type TechnicalModuleDemoRuntime = {
  snapshot: TechnicalModuleDemoSnapshot;
  view: TechnicalModuleDemoView;
  setPreset: (preset: TechnicalModuleDemoSnapshot["preset"]) => void;
  toggleColumn: (columnId: string) => void;
  setFilter: (filterId: string, value: string) => void;
  clearFilters: () => void;
  setSort: (sort: TechnicalSortState | null) => void;
  clearSort: () => void;
  persist: () => void;
  reload: () => void;
};

export type TechnicalModuleDemoStorageEnvelope = {
  version: number;
  state: TechnicalModuleDemoSnapshot;
};

export type TechnicalModuleDemoStorageBackend = TechnicalPreferencesStorageBackend;

export type TechnicalModuleDemoDataset<T> = {
  rows: T[];
  columns: TechnicalColumnDefinition[];
  filters: Array<TechnicalFilterDefinition<T>>;
  sorts: Array<TechnicalSortDefinition<T>>;
};
