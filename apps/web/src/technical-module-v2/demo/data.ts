import type { TechnicalModuleDemoDataset, TechnicalModuleDemoRow } from "./types.js";
import type { TechnicalColumnDefinition } from "../columns/types.js";
import type { TechnicalFilterDefinition } from "../filters/types.js";
import type { TechnicalSortDefinition } from "../sort/types.js";

export const technicalModuleDemoRows: TechnicalModuleDemoRow[] = [
  { id: 1, name: "Alpha", region: "North", status: "OK", amount: 20, active: true, day: "2026-06-01" },
  { id: 2, name: "Bravo", region: "West", status: "WARN", amount: 40, active: false, day: "2026-06-02" },
  { id: 3, name: "Charlie", region: "South", status: "OK", amount: 30, active: true, day: "2026-06-03" },
  { id: 4, name: "Delta", region: "East", status: "FAIL", amount: 10, active: false, day: "2026-06-04" },
  { id: 5, name: "Echo", region: "North", status: "WARN", amount: 50, active: true, day: "2026-06-05" }
];

export const technicalModuleDemoColumns: TechnicalColumnDefinition[] = [
  { id: "name", label: "Name", presets: ["basic", "advanced"] },
  { id: "status", label: "Status", presets: ["basic", "advanced"] },
  { id: "region", label: "Region", presets: ["advanced"] },
  { id: "amount", label: "Amount", presets: ["advanced"] },
  { id: "active", label: "Active", presets: ["advanced"] }
];

export const technicalModuleDemoFilters: Array<TechnicalFilterDefinition<TechnicalModuleDemoRow>> = [
  { id: "name", type: "text", getValue: (row) => row.name },
  { id: "status", type: "enum", getValue: (row) => row.status }
];

export const technicalModuleDemoSorts: Array<TechnicalSortDefinition<TechnicalModuleDemoRow>> = [
  { id: "name", getValue: (row) => row.name },
  { id: "amount", getValue: (row) => row.amount },
  { id: "day", getValue: (row) => row.day }
];

export const technicalModuleDemoDataset: TechnicalModuleDemoDataset<TechnicalModuleDemoRow> = {
  rows: technicalModuleDemoRows,
  columns: technicalModuleDemoColumns,
  filters: technicalModuleDemoFilters,
  sorts: technicalModuleDemoSorts
};
