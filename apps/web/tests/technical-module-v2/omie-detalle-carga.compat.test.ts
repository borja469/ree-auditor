import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHierarchyWithAggregates,
} from "../../src/technical-module-v2/index.js";
import type {
  TechnicalAggregateColumnDefinition,
  TechnicalHierarchyLevel
} from "../../src/technical-module-v2/index.js";
import { createTechnicalDataTableAdapter } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";
import type { TechnicalDataTableAdapterColumn } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";

type DetailRow = {
  id: string;
  fecha: string;
  periodo: number;
  clave: string;
  programaMd: number | null;
  volIda1: number | null;
  volIda2: number | null;
  volIda3: number | null;
  volXbid: number | null;
  energiaTotal: number | null;
  profitMd: number | null;
  profitTotal: number | null;
  precioMd: number | null;
  precioIda1: number | null;
  precioIda2: number | null;
  precioIda3: number | null;
  precioXbid: number | null;
};

type DailyRow = {
  fecha: string;
  periodos: number;
  programaMd: number | null;
  volIda1: number | null;
  volIda2: number | null;
  volIda3: number | null;
  volXbid: number | null;
  energiaTotal: number | null;
  profitMd: number | null;
  profitTotal: number | null;
  profitMedioEurMWh: number | null;
  precioMd: number | null;
  precioIda1: number | null;
  precioIda2: number | null;
  precioIda3: number | null;
  precioXbid: number | null;
  clave: string;
  rows: DetailRow[];
};

const rows: DetailRow[] = [
  { id: "r1", fecha: "2026-06-01", periodo: 1, clave: "A1", programaMd: 10, volIda1: 1, volIda2: 2, volIda3: 3, volXbid: 4, energiaTotal: 20, profitMd: 2, profitTotal: 5, precioMd: 50, precioIda1: 51, precioIda2: 52, precioIda3: 53, precioXbid: 54 },
  { id: "r2", fecha: "2026-06-01", periodo: 2, clave: "A2", programaMd: 20, volIda1: 2, volIda2: 3, volIda3: 4, volXbid: 5, energiaTotal: 30, profitMd: 3, profitTotal: 10, precioMd: 60, precioIda1: 61, precioIda2: 62, precioIda3: 63, precioXbid: 64 },
  { id: "r3", fecha: "2026-06-01", periodo: 3, clave: "A3", programaMd: 30, volIda1: 3, volIda2: 4, volIda3: 5, volXbid: 6, energiaTotal: 40, profitMd: 4, profitTotal: 15, precioMd: 70, precioIda1: 71, precioIda2: 72, precioIda3: null, precioXbid: 74 },
  { id: "r4", fecha: "2026-06-02", periodo: 1, clave: "B1", programaMd: 15, volIda1: 4, volIda2: 5, volIda3: 6, volXbid: 7, energiaTotal: 25, profitMd: 1, profitTotal: 8, precioMd: 40, precioIda1: 41, precioIda2: 42, precioIda3: null, precioXbid: 44 },
  { id: "r5", fecha: "2026-06-02", periodo: 2, clave: "B2", programaMd: null, volIda1: 5, volIda2: 6, volIda3: 7, volXbid: null, energiaTotal: null, profitMd: 2, profitTotal: 12, precioMd: 50, precioIda1: 51, precioIda2: 52, precioIda3: null, precioXbid: 54 },
  { id: "r6", fecha: "2026-06-02", periodo: 3, clave: "B3", programaMd: 25, volIda1: 6, volIda2: null, volIda3: 8, volXbid: 9, energiaTotal: 35, profitMd: 3, profitTotal: 16, precioMd: 60, precioIda1: 61, precioIda2: 62, precioIda3: null, precioXbid: 64 }
];

const hierarchyLevels: TechnicalHierarchyLevel<DetailRow>[] = [
  {
    id: "fecha",
    getKey: (row) => row.fecha,
    getLabel: (row) => row.fecha
  }
];

const aggregateDefinitions: Array<TechnicalAggregateColumnDefinition<DetailRow>> = [
  { id: "periodos", aggregate: "count" },
  { id: "programaMd", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.programaMd)) } },
  { id: "volIda1", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.volIda1)) } },
  { id: "volIda2", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.volIda2)) } },
  { id: "volIda3", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.volIda3)) } },
  { id: "volXbid", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.volXbid)) } },
  { id: "energiaTotal", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.energiaTotal)) } },
  { id: "profitMd", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.profitMd)) } },
  { id: "profitTotal", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => nullableSum(currentRows.map((row: DetailRow) => row.profitTotal)) } },
  { id: "profitMedioEurMWh", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => profitRate(nullableSum(currentRows.map((row: DetailRow) => row.profitTotal)), nullableSum(currentRows.map((row: DetailRow) => row.energiaTotal))) } },
  { id: "precioMd", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => mean(currentRows.map((row: DetailRow) => row.precioMd)) } },
  { id: "precioIda1", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => mean(currentRows.map((row: DetailRow) => row.precioIda1)) } },
  { id: "precioIda2", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => mean(currentRows.map((row: DetailRow) => row.precioIda2)) } },
  { id: "precioIda3", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => mean(currentRows.map((row: DetailRow) => row.precioIda3)) } },
  { id: "precioXbid", aggregate: { kind: "custom", calculate: (currentRows: DetailRow[]) => mean(currentRows.map((row: DetailRow) => row.precioXbid)) } }
];

const columns: Array<TechnicalDataTableAdapterColumn<DailyRow>> = [
  { id: "fecha", label: "Fecha", width: 116, sticky: true, type: "date", filter: "text", visibility: "basic", value: (row) => row.fecha },
  { id: "periodos", label: "Nº periodos", width: 72, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.periodos },
  { id: "programaMd", label: "Programa MD", width: 112, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.programaMd },
  { id: "volIda1", label: "Vol. IDA1", width: 96, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volIda1 },
  { id: "volIda2", label: "Vol. IDA2", width: 96, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volIda2 },
  { id: "volIda3", label: "Vol. IDA3", width: 96, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volIda3 },
  { id: "volXbid", label: "Vol. XBID", width: 96, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.volXbid },
  { id: "energiaTotal", label: "Energía total", width: 120, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.energiaTotal },
  { id: "profitTotal", label: "Profit total", width: 112, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.profitTotal },
  { id: "profitMedioEurMWh", label: "Profit medio €/MWh", width: 148, align: "right", type: "number", filter: "number", visibility: "basic", value: (row) => row.profitMedioEurMWh },
  { id: "precioMd", label: "Precio MD", width: 104, align: "right", type: "number", filter: "number", visibility: "advanced", value: (row) => row.precioMd },
  { id: "clave", label: "Clave", width: 120, filter: "text", visibility: "advanced", value: (row) => row.clave }
];

function nullableSum(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function mean(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function profitRate(profit: number | null, energy: number | null) {
  return profit === null || energy === null || energy === 0 ? null : profit / energy;
}

function sortDetailRows(input: DetailRow[]) {
  return [...input].sort((left, right) => {
    return left.fecha.localeCompare(right.fecha, "es") || left.periodo - right.periodo || left.clave.localeCompare(right.clave, "es");
  });
}

function buildLegacyDailyRows(input: DetailRow[]): DailyRow[] {
  const groups = new Map<string, DetailRow[]>();
  for (const row of input) {
    const current = groups.get(row.fecha) ?? [];
    current.push(row);
    groups.set(row.fecha, current);
  }

  return [...groups.entries()]
    .map(([fecha, dayRows]) => {
      const sortedRows = sortDetailRows(dayRows);
      const programaMd = nullableSum(sortedRows.map((row) => row.programaMd));
      const volIda1 = nullableSum(sortedRows.map((row) => row.volIda1));
      const volIda2 = nullableSum(sortedRows.map((row) => row.volIda2));
      const volIda3 = nullableSum(sortedRows.map((row) => row.volIda3));
      const volXbid = nullableSum(sortedRows.map((row) => row.volXbid));
      const energiaTotal = nullableSum(sortedRows.map((row) => row.energiaTotal));
      const profitMd = nullableSum(sortedRows.map((row) => row.profitMd));
      const profitTotal = nullableSum(sortedRows.map((row) => row.profitTotal));

      return {
        fecha,
        periodos: sortedRows.length,
        programaMd,
        volIda1,
        volIda2,
        volIda3,
        volXbid,
        energiaTotal,
        profitMd,
        profitTotal,
        profitMedioEurMWh: profitRate(profitTotal, energiaTotal),
        precioMd: mean(sortedRows.map((row) => row.precioMd)),
        precioIda1: mean(sortedRows.map((row) => row.precioIda1)),
        precioIda2: mean(sortedRows.map((row) => row.precioIda2)),
        precioIda3: mean(sortedRows.map((row) => row.precioIda3)),
        precioXbid: mean(sortedRows.map((row) => row.precioXbid)),
        clave: `${sortedRows.length} claves`,
        rows: sortedRows
      };
    })
    .sort((left, right) => left.fecha.localeCompare(right.fecha, "es"));
}

function buildV2DailyRows(input: DetailRow[]): DailyRow[] {
  return buildHierarchyWithAggregates(sortDetailRows(input), hierarchyLevels, aggregateDefinitions).map((node) => ({
    fecha: node.key,
    periodos: node.rows.length,
    programaMd: numberValue(node.aggregates.programaMd),
    volIda1: numberValue(node.aggregates.volIda1),
    volIda2: numberValue(node.aggregates.volIda2),
    volIda3: numberValue(node.aggregates.volIda3),
    volXbid: numberValue(node.aggregates.volXbid),
    energiaTotal: numberValue(node.aggregates.energiaTotal),
    profitMd: numberValue(node.aggregates.profitMd),
    profitTotal: numberValue(node.aggregates.profitTotal),
    profitMedioEurMWh: numberValue(node.aggregates.profitMedioEurMWh),
    precioMd: numberValue(node.aggregates.precioMd),
    precioIda1: numberValue(node.aggregates.precioIda1),
    precioIda2: numberValue(node.aggregates.precioIda2),
    precioIda3: numberValue(node.aggregates.precioIda3),
    precioXbid: numberValue(node.aggregates.precioXbid),
    clave: `${node.rows.length} claves`,
    rows: [...node.rows]
  }));
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

function buildLegacyVisibleRows(dailyRows: DailyRow[], expandedDays: Set<string>) {
  return dailyRows.flatMap((day) => [`day:${day.fecha}`, ...(expandedDays.has(day.fecha) ? day.rows.map((row) => `row:${row.id}`) : [])]);
}

function buildVisibleEntries(dailyRows: DailyRow[], expandedDays: Set<string>) {
  return dailyRows.flatMap((day) => [`day:${day.fecha}`, ...(expandedDays.has(day.fecha) ? day.rows.map((row) => `row:${row.id}`) : [])]);
}

function legacyFilterDailyRows(
  rowsToFilter: DailyRow[],
  state: {
    mode: "basic" | "advanced";
    search: string;
    filters: Record<string, string>;
    hiddenColumns: Set<string>;
  }
) {
  const adapter = createTechnicalDataTableAdapter({
    rows: rowsToFilter,
    columns,
    state: {
      mode: state.mode,
      search: state.search,
      filters: state.filters,
      hiddenColumns: [...state.hiddenColumns]
    },
    showModeSelector: true
  });

  return adapter;
}

function visibleColumns(mode: "basic" | "advanced", hiddenColumns: Set<string>) {
  const presetHidden = mode === "advanced" ? new Set<string>() : new Set(columns.filter((column) => column.visibility === "advanced").map((column) => column.id));
  return columns.filter((column) => !presetHidden.has(column.id) && !hiddenColumns.has(column.id));
}

test("grouped daily rows keep subtotal calculations and visible columns in sync", () => {
  const legacyDailyRows = buildLegacyDailyRows(rows);
  const v2DailyRows = buildV2DailyRows(rows);

  assert.deepEqual(v2DailyRows.map((row) => row.fecha), legacyDailyRows.map((row) => row.fecha));
  assert.deepEqual(v2DailyRows.map((row) => row.periodos), legacyDailyRows.map((row) => row.periodos));
  assert.deepEqual(v2DailyRows.map((row) => row.programaMd), legacyDailyRows.map((row) => row.programaMd));
  assert.deepEqual(v2DailyRows.map((row) => row.volIda2), legacyDailyRows.map((row) => row.volIda2));
  assert.deepEqual(v2DailyRows.map((row) => row.energiaTotal), legacyDailyRows.map((row) => row.energiaTotal));
  assert.deepEqual(v2DailyRows.map((row) => row.profitMedioEurMWh), legacyDailyRows.map((row) => row.profitMedioEurMWh));
  assert.deepEqual(v2DailyRows.map((row) => row.precioIda3), legacyDailyRows.map((row) => row.precioIda3));

  const hiddenColumns = new Set(["clave"]);
  const state = {
    mode: "basic" as const,
    search: "",
    filters: {},
    hiddenColumns
  };
  const legacyAdapter = legacyFilterDailyRows(legacyDailyRows, state);
  const v2Adapter = legacyFilterDailyRows(v2DailyRows, state);

  assert.deepEqual(v2Adapter.activeColumns.map((column) => column.id), legacyAdapter.activeColumns.map((column) => column.id));
  assert.deepEqual(
    visibleColumns("basic", hiddenColumns).map((column) => column.id),
    ["fecha", "periodos", "programaMd", "volIda1", "volIda2", "volIda3", "volXbid", "energiaTotal", "profitTotal", "profitMedioEurMWh"]
  );
});

test("grouped filtering and sorting match between legacy and V2", () => {
  const hiddenColumns = new Set(["clave"]);
  const state = {
    mode: "basic" as const,
    search: "2026-06-01",
    filters: {
      "programaMd:min": "10",
      "programaMd:max": "35"
    },
    hiddenColumns
  };

  const legacyDailyRows = buildLegacyDailyRows(rows);
  const v2DailyRows = buildV2DailyRows(rows);

  const legacyAdapter = legacyFilterDailyRows(legacyDailyRows, state);
  const v2Adapter = createTechnicalDataTableAdapter({
    rows: v2DailyRows,
    columns,
    state: {
      mode: state.mode,
      search: state.search,
      filters: state.filters,
      hiddenColumns: [...state.hiddenColumns],
      sort: { columnId: "programaMd", direction: "desc" }
    },
    showModeSelector: true
  });

  const legacySorted = createTechnicalDataTableAdapter({
    rows: legacyDailyRows,
    columns,
    state: {
      mode: state.mode,
      search: state.search,
      filters: state.filters,
      hiddenColumns: [...state.hiddenColumns],
      sort: { columnId: "programaMd", direction: "desc" }
    },
    showModeSelector: true
  });

  assert.deepEqual(v2Adapter.sortedRows.map((row: DailyRow) => row.fecha), legacySorted.sortedRows.map((row: DailyRow) => row.fecha));
  assert.deepEqual(
    v2Adapter.sortedRows.map((row: DailyRow) => row.rows.map((detail: DetailRow) => detail.id)),
    legacySorted.sortedRows.map((row: DailyRow) => row.rows.map((detail: DetailRow) => detail.id))
  );
  assert.deepEqual(v2Adapter.filteredRows.map((row: DailyRow) => row.fecha), legacyAdapter.filteredRows.map((row: DailyRow) => row.fecha));
});

test("group expansion keeps the same visible order and detail order inside each day", () => {
  const legacyDailyRows = buildLegacyDailyRows(rows);
  const v2DailyRows = buildV2DailyRows(rows);
  const expandedDays = new Set(["2026-06-01"]);

  assert.deepEqual(buildVisibleEntries(legacyDailyRows, expandedDays), buildVisibleEntries(v2DailyRows, expandedDays));
  assert.deepEqual(
    legacyDailyRows.find((row: DailyRow) => row.fecha === "2026-06-01")?.rows.map((row: DetailRow) => row.id),
    ["r1", "r2", "r3"]
  );
  assert.deepEqual(
    v2DailyRows.find((row: DailyRow) => row.fecha === "2026-06-01")?.rows.map((row: DetailRow) => row.id),
    ["r1", "r2", "r3"]
  );
  assert.deepEqual(buildLegacyVisibleRows(legacyDailyRows, expandedDays), buildLegacyVisibleRows(v2DailyRows, expandedDays));
});
