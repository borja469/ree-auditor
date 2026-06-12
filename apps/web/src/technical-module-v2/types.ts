import type { ReactNode } from "react";
import type { TechnicalAggregateDefinition, TechnicalAggregateKind } from "./aggregation/types.js";

export type TechnicalModuleMode = "flat" | "grouped" | "hierarchical";
export type TechnicalPreset = "basic" | "advanced";
export type TechnicalSortDirection = "asc" | "desc";
export type TechnicalFilterType = "text" | "number" | "select" | "date";
export type TechnicalDensity = "compact" | "regular";

export type TechnicalColumn<T> = {
  id: string;
  label: string;
  visibility?: TechnicalPreset;
  width: number;
  filter?: TechnicalFilterType;
  render?: (row: T) => ReactNode;
  exportValue?: (row: T) => string | number | null | undefined;
  aggregate?: TechnicalAggregateKind | TechnicalAggregateDefinition<T>;
  sortValue?: (row: T) => string | number | null | undefined;
  cellClassName?: (row: T) => string | undefined;
  headerClassName?: string;
  editable?: boolean | TechnicalEditableDefinition<T>;
};

export type TechnicalEditableDefinition<T> = {
  canEdit?: (row: T, columnId: string) => boolean;
  editor: "text" | "number" | "select" | "date" | "custom";
};

export type TechnicalGroupDef<T> = {
  id: string;
  label: string;
  getKey: (row: T) => string | number;
  getLabel?: (key: string | number, rows: T[]) => string;
  aggregateRow?: boolean;
  initiallyExpanded?: boolean;
};

export type TechnicalHierarchyDef<T> = {
  levels: Array<TechnicalGroupDef<T>>;
  expandByDefault?: "none" | "first" | "all";
};

export type TechnicalPreferencesState = {
  preset: TechnicalPreset;
  hiddenColumns: string[];
  columnOrder: string[];
  filters: Record<string, string>;
  sort?: {
    id: string;
    direction: TechnicalSortDirection;
  };
  expandedGroups: string[];
  density?: TechnicalDensity;
  columnWidths?: Record<string, number>;
};

export type TechnicalPreferencesStorage = {
  load: (key: string) => Promise<TechnicalPreferencesState | null> | TechnicalPreferencesState | null;
  save: (key: string, value: TechnicalPreferencesState) => Promise<void> | void;
  clear?: (key: string) => Promise<void> | void;
};

export type TechnicalKpiContext<T> = {
  rows: T[];
  visibleRows: T[];
  columns: Array<TechnicalColumn<T>>;
};

export type TechnicalKpiDef<T> = {
  id: string;
  label: string;
  tone?: "neutral" | "good" | "warning" | "danger";
  value: (ctx: TechnicalKpiContext<T>) => ReactNode;
  meta?: (ctx: TechnicalKpiContext<T>) => ReactNode;
};

export type TechnicalActionContext<T> = {
  rows: T[];
  visibleRows: T[];
  selectedRows: T[];
  columns: Array<TechnicalColumn<T>>;
};

export type TechnicalAction<T> = {
  id: string;
  label: string;
  icon?: ReactNode;
  hotkey?: string;
  visible?: (ctx: TechnicalActionContext<T>) => boolean;
  disabled?: (ctx: TechnicalActionContext<T>) => boolean;
  run: (ctx: TechnicalActionContext<T>) => Promise<void> | void;
};

export type TechnicalInlineEditConfig<T> = {
  enabled: boolean;
  optimistic?: boolean;
  canEdit?: (row: T, columnId: string) => boolean;
  validate?: (row: T, columnId: string, value: unknown) => string | null | Promise<string | null>;
  commit: (args: {
    row: T;
    columnId: string;
    value: unknown;
    previousValue: unknown;
  }) => Promise<T> | T;
};

export type TechnicalVirtualizationConfig = {
  mode: "auto" | "on" | "off";
  rowHeight?: number;
  overscan?: number;
};

export type TechnicalTableState = {
  mode: TechnicalPreset;
  search: string;
  filters: Record<string, string>;
  sort?: {
    id: string;
    direction: TechnicalSortDirection;
  };
  hiddenColumns: string[];
  expandedGroups: string[];
  selectedRowIds: string[];
  density: TechnicalDensity;
};

export type TechnicalTableData<T> = {
  rows: T[];
  columns: Array<TechnicalColumn<T>>;
  mode: TechnicalModuleMode;
  groupBy?: Array<TechnicalGroupDef<T>>;
  hierarchy?: TechnicalHierarchyDef<T>;
};

export type TechnicalModuleProps<T> = {
  title: string;
  subtitle?: ReactNode;
  data: TechnicalTableData<T>;
  kpis?: Array<TechnicalKpiDef<T>>;
  actions?: {
    global?: Array<TechnicalAction<undefined>>;
    row?: Array<TechnicalAction<T>>;
    group?: Array<TechnicalAction<T[]>>;
  };
  preferences?: {
    key: string;
    storage: TechnicalPreferencesStorage;
    version: number;
    defaultState?: Partial<TechnicalPreferencesState>;
    debounceMs?: number;
  };
  editing?: TechnicalInlineEditConfig<T>;
  virtualization?: TechnicalVirtualizationConfig;
  export?: {
    csvFileName: string;
    xlsFileName?: string;
  };
  showModeSelector?: boolean;
  showExport?: boolean;
  showCopy?: boolean;
  showSearch?: boolean;
  showColumnsMenu?: boolean;
  showKpis?: boolean;
  onStateChange?: (state: TechnicalTableState) => void;
  onAction?: (actionId: string) => void;
};
