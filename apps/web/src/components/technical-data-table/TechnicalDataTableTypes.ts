import type { ReactNode } from "react";

export type TechnicalDataMode = "basic" | "advanced";

export type TechnicalSortDirection = "asc" | "desc";

export type TechnicalColumn<T> = {
  id: string;
  label: string;
  headerMeta?: string | ((rows: T[]) => string);
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
  cellTone?: (row: T) => "good" | "bad" | "neutral" | undefined;
  filter?: "text" | "number" | "select";
  defaultHidden?: boolean;
  expectedEmpty?: (row: T) => boolean;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  exportValue?: (row: T) => string | number | null | undefined;
};

export type TechnicalKpi = {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
};

export type TechnicalTotalsRow<T> = (rows: T[]) => Record<string, ReactNode>;

export type RowQuality = {
  tone: "ok" | "warning" | "danger";
  labels: string[];
};

export type TechnicalEntry<T> = { type: "group"; key: string; label: string } | { type: "row"; key: string; row: T };

export type TechnicalDataTableProps<T extends object> = {
  title: string;
  rows: T[];
  columns: Array<TechnicalColumn<T>>;
  kpis: TechnicalKpi[];
  page: number;
  pageSize: number;
  hasNext: boolean;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  getRowId: (row: T) => string;
  getRowQuality: (row: T) => RowQuality;
  getGroupLabel: (row: T) => string;
  getDuplicateKey: (row: T) => string;
  exportFileName: string;
  getTotalsRow?: TechnicalTotalsRow<T>;
  loadExportRows?: () => Promise<T[]>;
  showHeaderTitle?: boolean;
  showQuality?: boolean;
  showPagination?: boolean;
  showModeSelector?: boolean;
};
