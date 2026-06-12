import assert from "node:assert/strict";
import test from "node:test";

import { createTechnicalDataTableAdapter } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";
import type { TechnicalDataTableAdapterColumn } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";

type OmiePrecioPeriodo = {
  clave: string;
  fecha: string;
  periodo: number;
  precioMd: number | null;
  precioMi1: number | null;
  precioMi2: number | null;
  precioMi3: number | null;
  precioXbid: number | null;
};

const rows: OmiePrecioPeriodo[] = [
  { clave: "A-01", fecha: "2026-06-01", periodo: 1, precioMd: 10, precioMi1: 11, precioMi2: 12, precioMi3: 13, precioXbid: 14 },
  { clave: "A-02", fecha: "2026-06-01", periodo: 2, precioMd: 20, precioMi1: 18, precioMi2: 22, precioMi3: 25, precioXbid: 19 },
  { clave: "B-01", fecha: "2026-06-02", periodo: 49, precioMd: 30, precioMi1: 31, precioMi2: 29, precioMi3: 32, precioXbid: 28 },
  { clave: "B-02", fecha: "2026-06-02", periodo: 50, precioMd: 40, precioMi1: 38, precioMi2: 44, precioMi3: null, precioXbid: 42 }
];

const columns: Array<TechnicalDataTableAdapterColumn<OmiePrecioPeriodo>> = [
  { id: "fecha", label: "Fecha", width: 116, sticky: true, type: "date", filter: "text", visibility: "basic", value: (row) => row.fecha },
  { id: "hora", label: "Hora", width: 82, sticky: true, filter: "select", visibility: "basic", value: (row) => omieHourLabel(row.periodo) },
  { id: "periodo", label: "Cuarto de hora", width: 118, sticky: true, type: "number", filter: "number", visibility: "basic", value: (row) => row.periodo },
  { id: "precioMd", label: "Precios MD", width: 118, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.precioMd },
  { id: "precioMi1", label: "Precios Intradiario 1", width: 162, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.precioMi1 },
  { id: "precioMi2", label: "Precios Intradiario 2", width: 162, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.precioMi2 },
  { id: "precioMi3", label: "Precios Intradiario 3", width: 162, align: "right", type: "number", filter: "number", visibility: "basic", expectedEmpty: (row) => row.periodo < 49, value: (row) => row.precioMi3 },
  { id: "precioXbid", label: "Precios XBID", width: 132, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.precioXbid },
  { id: "clave", label: "Clave", width: 126, filter: "text", visibility: "advanced", value: (row) => row.clave },
  { id: "difMi1Md", label: "Dif IDA1 - MD", width: 132, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => spread(row.precioMi1, row.precioMd) },
  { id: "variacionMdAnterior", label: "Var. MD anterior", width: 136, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioMd }
];

function omieHourLabel(periodo: number) {
  const hour = Math.floor((periodo - 1) / 4) + 1;
  const quarter = ((periodo - 1) % 4) + 1;
  return `${String(hour).padStart(2, "0")}:${quarter * 15 === 60 ? "60" : String((quarter - 1) * 15).padStart(2, "0")}`;
}

function spread(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return null;
  }
  return left - right;
}

function technicalColumnVisibility(column: { visibility?: "basic" | "advanced"; advanced?: boolean }) {
  return column.visibility ?? (column.advanced ? "advanced" : "basic");
}

function buildTechnicalPresetHiddenColumns(mode: "basic" | "advanced") {
  if (mode === "advanced") {
    return new Set<string>();
  }

  return new Set(columns.filter((column) => technicalColumnVisibility(column) === "advanced").map((column) => column.id));
}

function legacyVisibleColumns(mode: "basic" | "advanced", hiddenColumns: Set<string>) {
  const presetHidden = buildTechnicalPresetHiddenColumns(mode);
  return columns.filter((column) => !hiddenColumns.has(column.id) && !presetHidden.has(column.id));
}

function normalizeNumericValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareTechnicalValues(left: string | number | null | undefined, right: string | number | null | undefined, type?: "text" | "number" | "date") {
  if (type === "number") {
    return (normalizeNumericValue(left) ?? Number.NEGATIVE_INFINITY) - (normalizeNumericValue(right) ?? Number.NEGATIVE_INFINITY);
  }

  if (type === "date") {
    return String(left ?? "").localeCompare(String(right ?? ""), "es");
  }

  return String(left ?? "").localeCompare(String(right ?? ""), "es", { numeric: true, sensitivity: "base" });
}

function legacyFilterRows(
  inputRows: OmiePrecioPeriodo[],
  activeColumns: Array<TechnicalDataTableAdapterColumn<OmiePrecioPeriodo>>,
  filters: Record<string, string>,
  search: string,
  sort?: { id: string; direction: "asc" | "desc" }
) {
  const normalizedSearch = search.trim().toLowerCase();
  const nextRows = inputRows.filter((row) => {
    if (normalizedSearch) {
      const haystack = activeColumns.map((column) => String(column.value(row) ?? "")).join(" ").toLowerCase();
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return activeColumns.every((column) => {
      if (column.filter === "number") {
        const value = normalizeNumericValue(column.value(row));
        const min = normalizeNumericValue(filters[`${column.id}:min`]);
        const max = normalizeNumericValue(filters[`${column.id}:max`]);
        return (min === undefined || (value !== undefined && value >= min)) && (max === undefined || (value !== undefined && value <= max));
      }

      const filterValue = filters[column.id]?.trim();
      if (!filterValue) {
        return true;
      }

      const value = String(column.value(row) ?? "");
      return column.filter === "select" ? value === filterValue : value.toLowerCase().includes(filterValue.toLowerCase());
    });
  });

  if (!sort) {
    return nextRows;
  }

  const column = activeColumns.find((item) => item.id === sort.id);
  if (!column) {
    return nextRows;
  }

  return [...nextRows].sort((left, right) => compareTechnicalValues(column.value(left), column.value(right), column.type) * (sort.direction === "asc" ? 1 : -1));
}

test("legacy and v2 visible columns match for basic and advanced modes", () => {
  const basicHidden = buildTechnicalPresetHiddenColumns("basic");
  const advancedHidden = new Set<string>(["clave"]);

  const basicAdapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { mode: "basic", search: "", filters: {}, hiddenColumns: [...basicHidden] },
    showModeSelector: true
  });

  const advancedAdapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { mode: "advanced", search: "", filters: {}, hiddenColumns: [...advancedHidden] },
    showModeSelector: true
  });

  assert.deepEqual(
    basicAdapter.activeColumns.map((column) => column.id),
    legacyVisibleColumns("basic", basicHidden).map((column) => column.id)
  );
  assert.deepEqual(
    advancedAdapter.activeColumns.map((column) => column.id),
    legacyVisibleColumns("advanced", advancedHidden).map((column) => column.id)
  );
});

test("legacy and v2 filtered rows match for search, text, select and number filters", () => {
  const state = {
    mode: "advanced" as const,
    search: "2026-06-02",
    filters: {
      hora: "00:00",
      periodo: "49",
      "precioMd:min": "25",
      "precioMd:max": "35"
    },
    hiddenColumns: []
  };

  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state,
    showModeSelector: true
  });

  const legacyActiveColumns = legacyVisibleColumns(state.mode, new Set(state.hiddenColumns));
  const legacyRows = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search);

  assert.deepEqual(adapter.filteredRows.map((row) => row.clave), legacyRows.map((row) => row.clave));
});

test("legacy and v2 sort rows identically in asc and desc", () => {
  const state = {
    mode: "advanced" as const,
    search: "",
    filters: {},
    hiddenColumns: ["clave"]
  };

  const legacyActiveColumns = legacyVisibleColumns(state.mode, new Set(state.hiddenColumns));
  const legacyAsc = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search, { id: "precioMd", direction: "asc" });
  const legacyDesc = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search, { id: "precioMd", direction: "desc" });

  const adapterAsc = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { ...state, sort: { columnId: "precioMd", direction: "asc" } },
    showModeSelector: true
  });

  const adapterDesc = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { ...state, sort: { columnId: "precioMd", direction: "desc" } },
    showModeSelector: true
  });

  assert.deepEqual(adapterAsc.sortedRows.map((row) => row.clave), legacyAsc.map((row) => row.clave));
  assert.deepEqual(adapterDesc.sortedRows.map((row) => row.clave), legacyDesc.map((row) => row.clave));
});
