import assert from "node:assert/strict";
import test from "node:test";

import { createTechnicalDataTableAdapter } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";
import type { TechnicalDataTableAdapterColumn } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";

type ReganecuHourlyRow = {
  id: string;
  fecha: string | null;
  hora: number | null;
  version: string;
  segmento: string | null;
  codigoPrecio: string | null;
  codigoApunte: string | null;
  eicUpr: string | null;
  codigoUpr: string | null;
  energiaMwh: number | null;
  importeEur: number | null;
  importeDiferenciaEur: number | null;
  precioEurMwh: number | null;
  brp: string | null;
  sourceLineNumber: number;
  importeConsistente: boolean;
  precioAnomalo: boolean;
  rawPayloadJson?: {
    fecha?: string;
    hora?: string;
  } | null;
};

const rows: ReganecuHourlyRow[] = [
  {
    id: "r1",
    fecha: "2026-05-01",
    hora: 1,
    version: "C1",
    segmento: "CAD",
    codigoPrecio: "P1",
    codigoApunte: "A1",
    eicUpr: "UPR-100",
    codigoUpr: "UPR-100",
    energiaMwh: 10,
    importeEur: 100,
    importeDiferenciaEur: 0,
    precioEurMwh: 10,
    brp: "BRP-A",
    sourceLineNumber: 10,
    importeConsistente: true,
    precioAnomalo: false
  },
  {
    id: "r2",
    fecha: "2026-05-01",
    hora: 2,
    version: "C2",
    segmento: "DSV",
    codigoPrecio: "P2",
    codigoApunte: "A2",
    eicUpr: "UPR-200",
    codigoUpr: "UPR-200",
    energiaMwh: 20,
    importeEur: 200,
    importeDiferenciaEur: 0.2,
    precioEurMwh: 10,
    brp: "BRP-B",
    sourceLineNumber: 11,
    importeConsistente: true,
    precioAnomalo: false
  },
  {
    id: "r3",
    fecha: "2026-05-02",
    hora: 3,
    version: "C3",
    segmento: "CAD",
    codigoPrecio: "P1",
    codigoApunte: "A1",
    eicUpr: "UPR-100",
    codigoUpr: "UPR-100",
    energiaMwh: 15,
    importeEur: 150,
    importeDiferenciaEur: 0.1,
    precioEurMwh: 10,
    brp: "BRP-A",
    sourceLineNumber: 12,
    importeConsistente: true,
    precioAnomalo: false
  },
  {
    id: "r4",
    fecha: "2026-05-03",
    hora: 4,
    version: "C4",
    segmento: "BSV",
    codigoPrecio: "P3",
    codigoApunte: "A3",
    eicUpr: "UPR-300",
    codigoUpr: "UPR-300",
    energiaMwh: null,
    importeEur: null,
    importeDiferenciaEur: null,
    precioEurMwh: null,
    brp: "BRP-C",
    sourceLineNumber: 13,
    importeConsistente: false,
    precioAnomalo: true
  }
];

const columns: Array<TechnicalDataTableAdapterColumn<ReganecuHourlyRow>> = [
  {
    id: "fecha",
    label: "Fecha",
    width: 118,
    sticky: true,
    type: "date",
    filter: "text",
    visibility: "basic",
    value: (row) => row.fecha ?? row.rawPayloadJson?.fecha ?? ""
  },
  {
    id: "periodo",
    label: "Hora",
    help: "Hora de la liquidación.",
    width: 90,
    sticky: true,
    align: "right",
    type: "number",
    filter: "number",
    visibility: "basic",
    value: (row) => row.hora ?? row.rawPayloadJson?.hora ?? ""
  },
  {
    id: "codigo",
    label: "EIC UPR",
    width: 154,
    sticky: true,
    filter: "text",
    visibility: "basic",
    value: (row) => row.eicUpr ?? row.codigoUpr
  },
  { id: "energia", label: "Energía", help: "Energía liquidada en MWh.", width: 128, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.energiaMwh },
  { id: "importe", label: "Importe", help: "Importe liquidado en euros.", width: 128, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.importeEur },
  { id: "diferencia", label: "Dif.", help: "Diferencia entre importe informado e importe calculado.", width: 110, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.importeDiferenciaEur },
  { id: "version", label: "Versión", width: 86, advanced: true, filter: "select", value: (row) => row.version },
  { id: "segmento", label: "Segmento", width: 110, filter: "select", value: (row) => row.segmento },
  { id: "codigoPrecio", label: "Cod. precio", help: "Código de precio REE aplicado al apunte.", width: 132, advanced: true, filter: "select", value: (row) => row.codigoPrecio },
  { id: "codigoApunte", label: "Cod. apunte", help: "Código técnico del apunte liquidado.", width: 136, advanced: true, filter: "select", value: (row) => row.codigoApunte },
  { id: "precio", label: "Precio", width: 126, advanced: true, align: "right", type: "number", filter: "number", value: (row) => row.precioEurMwh },
  { id: "brp", label: "BRP", width: 120, advanced: true, filter: "text", value: (row) => row.brp },
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
  inputRows: ReganecuHourlyRow[],
  activeColumns: Array<TechnicalDataTableAdapterColumn<ReganecuHourlyRow>>,
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

test("legacy and v2 visible columns match for REGANECU hourly basic and advanced modes", () => {
  const basicHidden = new Set<string>([...buildTechnicalPresetHiddenColumns("basic"), "segmento", "ghost", "segmento"]);
  const advancedHidden = new Set<string>(["codigoApunte", "ghost", "codigoApunte"]);

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

test("legacy and v2 filtered rows match for REGANECU hourly search and filters", () => {
  const state = {
    mode: "basic" as const,
    search: "UPR-100",
    filters: {
      fecha: "2026-05-0",
      codigo: "UPR-100",
      "energia:min": "10",
      "energia:max": "15"
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

  assert.equal(adapter.filteredRows.length, legacyRows.length);
  assert.deepEqual(adapter.filteredRows.map((row) => row.id), legacyRows.map((row) => row.id));
  assert.deepEqual(adapter.searchRows.map((row) => row.id), legacyRows.map((row) => row.id));
});

test("legacy and v2 sort rows identically for REGANECU hourly asc and desc", () => {
  const state = {
    mode: "advanced" as const,
    search: "",
    filters: {},
    hiddenColumns: ["codigoApunte"]
  };

  const legacyActiveColumns = legacyVisibleColumns(state.mode, new Set(state.hiddenColumns));
  const legacyAsc = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search, { id: "energia", direction: "asc" });
  const legacyDesc = legacyFilterRows(rows, legacyActiveColumns, state.filters, state.search, { id: "energia", direction: "desc" });

  const adapterAsc = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { ...state, sort: { columnId: "energia", direction: "asc" } },
    showModeSelector: true
  });

  const adapterDesc = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: { ...state, sort: { columnId: "energia", direction: "desc" } },
    showModeSelector: true
  });

  assert.deepEqual(adapterAsc.sortedRows.map((row) => row.id), legacyAsc.map((row) => row.id));
  assert.deepEqual(adapterDesc.sortedRows.map((row) => row.id), legacyDesc.map((row) => row.id));
});
