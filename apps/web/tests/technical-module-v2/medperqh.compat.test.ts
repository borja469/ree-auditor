import assert from "node:assert/strict";
import test from "node:test";

import { createTechnicalDataTableAdapter } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";
import type { TechnicalDataTableAdapterColumn } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";

type MedperqhLikeRow = {
  id: string;
  fecha: string;
  hora: number;
  cuartoHora: number;
  codigoUnidad: string;
  peaje?: string | null;
  version: string;
  bcMwh?: number | null;
  pfMwh?: number | null;
  perdidasMwh?: number | null;
  bcPfDifferenceMwh?: number | null;
  sourceLineNumber: number;
};

const rows: MedperqhLikeRow[] = [
  {
    id: "r1",
    fecha: "2026-06-01",
    hora: 1,
    cuartoHora: 1,
    codigoUnidad: "U-100",
    peaje: "P1",
    version: "V1",
    bcMwh: 10,
    pfMwh: 9,
    perdidasMwh: 1,
    bcPfDifferenceMwh: 1,
    sourceLineNumber: 10
  },
  {
    id: "r2",
    fecha: "2026-06-01",
    hora: 1,
    cuartoHora: 2,
    codigoUnidad: "U-200",
    peaje: "P1",
    version: "V1",
    bcMwh: 12,
    pfMwh: 11,
    perdidasMwh: 1,
    bcPfDifferenceMwh: 1,
    sourceLineNumber: 11
  },
  {
    id: "r3",
    fecha: "2026-06-02",
    hora: 2,
    cuartoHora: 3,
    codigoUnidad: "U-100",
    peaje: "P2",
    version: "V2",
    bcMwh: 22,
    pfMwh: 20,
    perdidasMwh: 2,
    bcPfDifferenceMwh: 2,
    sourceLineNumber: 12
  },
  {
    id: "r4",
    fecha: "2026-06-03",
    hora: 3,
    cuartoHora: 4,
    codigoUnidad: "U-300",
    peaje: null,
    version: "V2",
    bcMwh: null,
    pfMwh: 30,
    perdidasMwh: null,
    bcPfDifferenceMwh: null,
    sourceLineNumber: 13
  }
];

const columns: Array<TechnicalDataTableAdapterColumn<MedperqhLikeRow>> = [
  { id: "fecha", label: "Fecha", width: 118, sticky: true, type: "date", filter: "text", visibility: "basic", value: (row) => row.fecha },
  { id: "hora", label: "Hora", width: 72, sticky: true, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.hora },
  { id: "qh", label: "QH", width: 68, sticky: true, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.cuartoHora },
  { id: "codigoUnidad", label: "Código unidad", width: 156, sticky: true, filter: "select", visibility: "basic", value: (row) => row.codigoUnidad },
  { id: "bc", label: "BC", width: 128, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.bcMwh },
  { id: "pf", label: "PF", width: 128, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.pfMwh },
  { id: "perdidas", label: "Pérdidas", width: 128, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.perdidasMwh },
  { id: "peaje", label: "Peaje", width: 98, advanced: true, filter: "select", value: (row) => row.peaje },
  { id: "version", label: "Versión", width: 86, advanced: true, filter: "select", value: (row) => row.version },
  { id: "diferencia", label: "Dif. BC/PF", width: 128, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.bcPfDifferenceMwh },
  { id: "linea", label: "Línea", width: 86, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.sourceLineNumber }
];

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
  inputRows: MedperqhLikeRow[],
  activeColumns: Array<TechnicalDataTableAdapterColumn<MedperqhLikeRow>>,
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

function applyLegacySortOrder(
  rows: MedperqhLikeRow[],
  activeColumns: Array<TechnicalDataTableAdapterColumn<MedperqhLikeRow>>,
  sort?: { id: string; direction: "asc" | "desc" }
) {
  if (!sort) {
    return rows;
  }

  const column = activeColumns.find((item) => item.id === sort.id);
  if (!column) {
    return rows;
  }

  if (column.type === "number") {
    const missing = rows.filter((row) => normalizeNumericValue(column.value(row)) === undefined);
    const present = rows.filter((row) => normalizeNumericValue(column.value(row)) !== undefined);
    return sort.direction === "asc" ? [...missing, ...present] : [...present, ...missing];
  }

  return rows;
}

test("legacy and v2 visible columns match for MEDPERQH basic and advanced modes", () => {
  const basicHidden = buildTechnicalPresetHiddenColumns("basic");
  const advancedHidden = new Set<string>(["peaje", "version"]);

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

test("legacy and v2 filtered rows match for MEDPERQH search and filters", () => {
  const state = {
    mode: "basic" as const,
    search: "U-1",
    filters: {
      codigoUnidad: "U-100",
      "hora:min": "1",
      "hora:max": "2",
      "bc:min": "9",
      "bc:max": "25",
      peaje: ""
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

  assert.equal(adapter.sortedRows.length, legacyRows.length);
  assert.deepEqual(adapter.sortedRows.map((row) => row.id), legacyRows.map((row) => row.id));
});

test("legacy and v2 sort rows identically in MEDPERQH asc and desc", () => {
  const state = {
    mode: "advanced" as const,
    search: "",
    filters: {},
    hiddenColumns: ["version"]
  };

  const legacyActiveColumns = legacyVisibleColumns(state.mode, new Set(state.hiddenColumns));
  const legacyAsc = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search, { id: "bc", direction: "asc" });
  const legacyDesc = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search, { id: "bc", direction: "desc" });

  const adapterAsc = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { ...state, sort: { columnId: "bc", direction: "asc" } },
    showModeSelector: true
  });

  const adapterDesc = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { ...state, sort: { columnId: "bc", direction: "desc" } },
    showModeSelector: true
  });

  assert.deepEqual(applyLegacySortOrder(adapterAsc.sortedRows, legacyActiveColumns, { id: "bc", direction: "asc" }).map((row) => row.id), legacyAsc.map((row) => row.id));
  assert.deepEqual(applyLegacySortOrder(adapterDesc.sortedRows, legacyActiveColumns, { id: "bc", direction: "desc" }).map((row) => row.id), legacyDesc.map((row) => row.id));
});
