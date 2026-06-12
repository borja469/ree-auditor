import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateHierarchy,
  buildHierarchy,
  buildHierarchyWithAggregates,
  findHierarchyNode,
  flattenHierarchy,
  getHierarchyTotals
} from "../../src/technical-module-v2/index.js";
import type { TechnicalAggregateColumnDefinition, TechnicalHierarchyLevel } from "../../src/technical-module-v2/index.js";

type Row = {
  id: string;
  month: string;
  day: string;
  hour: string;
  cuartohorario: string;
  amount: number;
};

const rows: Row[] = [
  { id: "r1", month: "2026-06", day: "2026-06-01", hour: "01", cuartohorario: "Q1", amount: 10 },
  { id: "r2", month: "2026-06", day: "2026-06-01", hour: "02", cuartohorario: "Q2", amount: 20 },
  { id: "r3", month: "2026-06", day: "2026-06-02", hour: "01", cuartohorario: "Q3", amount: 30 },
  { id: "r4", month: "2026-07", day: "2026-07-01", hour: "01", cuartohorario: "Q1", amount: 40 },
  { id: "r5", month: "2026-07", day: "2026-07-01", hour: "01", cuartohorario: "Q1", amount: 50 }
];

const dayOnlyLevels: TechnicalHierarchyLevel<Row>[] = [
  {
    id: "day",
    getKey: (row) => row.day,
    getLabel: (row) => row.day
  }
];

const monthlyHierarchy: TechnicalHierarchyLevel<Row>[] = [
  {
    id: "month",
    getKey: (row) => row.month,
    getLabel: (row) => `Month ${row.month}`
  },
  {
    id: "day",
    getKey: (row) => row.day,
    getLabel: (row) => `Day ${row.day}`
  },
  {
    id: "hour",
    getKey: (row) => row.hour,
    getLabel: (row) => `Hour ${row.hour}`
  }
];

type CargaRow = {
  id: string;
  day: string;
  quarter: string;
  programaMd: number | null;
  volIda1: number | null;
  volIda2: number | null;
  volIda3: number | null;
  volXbid: number | null;
  energiaTotal: number | null;
  profitTotal: number | null;
};

const cargaRows: CargaRow[] = [
  { id: "c1", day: "2026-06-01", quarter: "Q1", programaMd: 10, volIda1: 1, volIda2: 2, volIda3: 3, volXbid: 4, energiaTotal: 20, profitTotal: 5 },
  { id: "c2", day: "2026-06-01", quarter: "Q2", programaMd: 20, volIda1: 2, volIda2: 3, volIda3: 4, volXbid: 5, energiaTotal: 30, profitTotal: 10 },
  { id: "c3", day: "2026-06-02", quarter: "Q1", programaMd: 30, volIda1: 3, volIda2: 4, volIda3: 5, volXbid: 6, energiaTotal: 40, profitTotal: 15 }
];

const cargaLevels: TechnicalHierarchyLevel<CargaRow>[] = [
  {
    id: "day",
    getKey: (row) => row.day,
    getLabel: (row) => `Day ${row.day}`
  }
];

const cargaAggregates: Array<TechnicalAggregateColumnDefinition<CargaRow>> = [
  { id: "programaMd", aggregate: { kind: "sum", getValue: (row) => row.programaMd } },
  { id: "volIda1", aggregate: { kind: "sum", getValue: (row) => row.volIda1 } },
  { id: "volIda2", aggregate: { kind: "sum", getValue: (row) => row.volIda2 } },
  { id: "volIda3", aggregate: { kind: "sum", getValue: (row) => row.volIda3 } },
  { id: "volXbid", aggregate: { kind: "sum", getValue: (row) => row.volXbid } },
  { id: "energiaTotal", aggregate: { kind: "sum", getValue: (row) => row.energiaTotal } },
  { id: "profitTotal", aggregate: { kind: "sum", getValue: (row) => row.profitTotal } },
  {
    id: "quarterList",
    aggregate: {
      kind: "custom",
      calculate: (currentRows) => currentRows.map((row) => row.quarter).join("|")
    }
  },
  { id: "rowCount", aggregate: "count" }
];

type LiquidacionRow = {
  id: string;
  month: string;
  day: string;
  hour: string;
  costeMd: number | null;
  costeIda1: number | null;
  costeIda2: number | null;
  costeIda3: number | null;
  costeXbid: number | null;
  costeTotalOmie: number | null;
  facturaCompra: number | null;
  facturaVenta: number | null;
  descuadre: number | null;
};

const liquidacionRows: LiquidacionRow[] = [
  {
    id: "l1",
    month: "2026-06",
    day: "2026-06-01",
    hour: "01",
    costeMd: 10,
    costeIda1: 1,
    costeIda2: 2,
    costeIda3: 3,
    costeXbid: 4,
    costeTotalOmie: 20,
    facturaCompra: 30,
    facturaVenta: 40,
    descuadre: -10
  },
  {
    id: "l2",
    month: "2026-06",
    day: "2026-06-01",
    hour: "02",
    costeMd: 20,
    costeIda1: 2,
    costeIda2: 3,
    costeIda3: 4,
    costeXbid: 5,
    costeTotalOmie: 30,
    facturaCompra: 60,
    facturaVenta: 70,
    descuadre: -10
  },
  {
    id: "l3",
    month: "2026-06",
    day: "2026-06-02",
    hour: "01",
    costeMd: 30,
    costeIda1: 3,
    costeIda2: 4,
    costeIda3: 5,
    costeXbid: 6,
    costeTotalOmie: 40,
    facturaCompra: 90,
    facturaVenta: 100,
    descuadre: -10
  }
];

const liquidacionLevels: TechnicalHierarchyLevel<LiquidacionRow>[] = [
  {
    id: "month",
    getKey: (row) => row.month,
    getLabel: (row) => `Month ${row.month}`
  },
  {
    id: "day",
    getKey: (row) => row.day,
    getLabel: (row) => `Day ${row.day}`
  },
  {
    id: "hour",
    getKey: (row) => row.hour,
    getLabel: (row) => `Hour ${row.hour}`
  }
];

const liquidacionAggregates: Array<TechnicalAggregateColumnDefinition<LiquidacionRow>> = [
  { id: "costeMd", aggregate: { kind: "sum", getValue: (row) => row.costeMd } },
  { id: "costeIda1", aggregate: { kind: "sum", getValue: (row) => row.costeIda1 } },
  { id: "costeIda2", aggregate: { kind: "sum", getValue: (row) => row.costeIda2 } },
  { id: "costeIda3", aggregate: { kind: "sum", getValue: (row) => row.costeIda3 } },
  { id: "costeXbid", aggregate: { kind: "sum", getValue: (row) => row.costeXbid } },
  { id: "costeTotalOmie", aggregate: { kind: "sum", getValue: (row) => row.costeTotalOmie } },
  { id: "facturaCompra", aggregate: { kind: "sum", getValue: (row) => row.facturaCompra } },
  { id: "facturaVenta", aggregate: { kind: "sum", getValue: (row) => row.facturaVenta } },
  { id: "descuadre", aggregate: { kind: "sum", getValue: (row) => row.descuadre } }
];

test("flat without levels returns one node per row", () => {
  const hierarchy = buildHierarchy(rows, []);

  assert.equal(hierarchy.length, 5);
  assert.deepEqual(hierarchy.map((node) => node.id), ["flat=0", "flat=1", "flat=2", "flat=3", "flat=4"]);
  assert.deepEqual(hierarchy.map((node) => node.rows.map((row) => row.id)), [["r1"], ["r2"], ["r3"], ["r4"], ["r5"]]);
  assert.deepEqual(hierarchy.map((node) => node.children), [[], [], [], [], []]);
});

test("grouped with one level merges repeated keys and keeps stable order", () => {
  const hierarchy = buildHierarchy(rows, dayOnlyLevels);

  assert.deepEqual(hierarchy.map((node) => node.id), [
    "day=2026-06-01",
    "day=2026-06-02",
    "day=2026-07-01"
  ]);
  assert.deepEqual(hierarchy.map((node) => node.label), ["2026-06-01", "2026-06-02", "2026-07-01"]);
  assert.deepEqual(hierarchy.map((node) => node.rows.map((row) => row.id)), [["r1", "r2"], ["r3"], ["r4", "r5"]]);
  assert.deepEqual(hierarchy.map((node) => node.children), [[], [], []]);
});

test("hierarchical with multiple levels preserves depth and order", () => {
  const hierarchy = buildHierarchy(rows, monthlyHierarchy);

  assert.deepEqual(hierarchy.map((node) => node.id), ["month=2026-06", "month=2026-07"]);
  assert.deepEqual(hierarchy.map((node) => node.depth), [0, 0]);
  assert.deepEqual(hierarchy[0].children.map((node) => node.id), ["month=2026-06/day=2026-06-01", "month=2026-06/day=2026-06-02"]);
  assert.deepEqual(hierarchy[0].children[0].children.map((node) => node.id), [
    "month=2026-06/day=2026-06-01/hour=01",
    "month=2026-06/day=2026-06-01/hour=02"
  ]);
  assert.deepEqual(hierarchy[1].children[0].rows.map((row) => row.id), ["r4", "r5"]);
});

test("flattenHierarchy returns a depth-first stable order", () => {
  const hierarchy = buildHierarchy(rows, monthlyHierarchy);
  const flattened = flattenHierarchy(hierarchy);

  assert.deepEqual(flattened.map((node) => node.id), [
    "month=2026-06",
    "month=2026-06/day=2026-06-01",
    "month=2026-06/day=2026-06-01/hour=01",
    "month=2026-06/day=2026-06-01/hour=02",
    "month=2026-06/day=2026-06-02",
    "month=2026-06/day=2026-06-02/hour=01",
    "month=2026-07",
    "month=2026-07/day=2026-07-01",
    "month=2026-07/day=2026-07-01/hour=01"
  ]);
});

test("findHierarchyNode resolves nested nodes and returns null for missing ids", () => {
  const hierarchy = buildHierarchy(rows, monthlyHierarchy);

  const found = findHierarchyNode(hierarchy, "month=2026-06/day=2026-06-01/hour=02");
  assert.equal(found?.label, "Hour 02");
  assert.deepEqual(found?.rows.map((row) => row.id), ["r2"]);
  assert.equal(findHierarchyNode(hierarchy, "missing"), null);
});

test("getHierarchyTotals returns subtree row counts for every node", () => {
  const hierarchy = buildHierarchy(rows, monthlyHierarchy);
  const totals = getHierarchyTotals(hierarchy);

  assert.deepEqual(totals, {
    "month=2026-06": 3,
    "month=2026-06/day=2026-06-01": 2,
    "month=2026-06/day=2026-06-01/hour=01": 1,
    "month=2026-06/day=2026-06-01/hour=02": 1,
    "month=2026-06/day=2026-06-02": 1,
    "month=2026-06/day=2026-06-02/hour=01": 1,
    "month=2026-07": 2,
    "month=2026-07/day=2026-07-01": 2,
    "month=2026-07/day=2026-07-01/hour=01": 2
  });
});

test("buildHierarchy returns an empty tree for empty input", () => {
  const hierarchy = buildHierarchy([], monthlyHierarchy);

  assert.deepEqual(hierarchy, []);
  assert.deepEqual(flattenHierarchy(hierarchy), []);
  assert.deepEqual(getHierarchyTotals(hierarchy), {});
  assert.equal(findHierarchyNode(hierarchy, "month=2026-06"), null);
});

test("multiple real-like levels can represent Detalle de Carga and Comprobacion Liquidaciones", () => {
  const cargaHierarchy = buildHierarchy(cargaRows, cargaLevels);
  const liquidacionHierarchy = buildHierarchy(liquidacionRows, liquidacionLevels);

  assert.equal(cargaHierarchy[0].label, "Day 2026-06-01");
  assert.deepEqual(cargaHierarchy[0].rows.map((row) => row.id), ["c1", "c2"]);
  assert.equal(liquidacionHierarchy[0].label, "Month 2026-06");
  assert.equal(liquidacionHierarchy[0].children[0].label, "Day 2026-06-01");
  assert.equal(liquidacionHierarchy[0].children[0].children[0].label, "Hour 01");
});

test("aggregateHierarchy attaches aggregates to an existing grouped tree", () => {
  const hierarchy = buildHierarchy(cargaRows, cargaLevels);
  const aggregated = aggregateHierarchy(hierarchy, cargaAggregates);

  assert.deepEqual(aggregated[0].aggregates, {
    programaMd: 30,
    volIda1: 3,
    volIda2: 5,
    volIda3: 7,
    volXbid: 9,
    energiaTotal: 50,
    profitTotal: 15,
    quarterList: "Q1|Q2",
    rowCount: 2
  });
  assert.deepEqual(aggregated[1].aggregates, {
    programaMd: 30,
    volIda1: 3,
    volIda2: 4,
    volIda3: 5,
    volXbid: 6,
    energiaTotal: 40,
    profitTotal: 15,
    quarterList: "Q1",
    rowCount: 1
  });
});

test("buildHierarchyWithAggregates creates hierarchical subtotals without mutating input rows", () => {
  const aggregated = buildHierarchyWithAggregates(liquidacionRows, liquidacionLevels, liquidacionAggregates);

  assert.deepEqual(aggregated[0].aggregates, {
    costeMd: 60,
    costeIda1: 6,
    costeIda2: 9,
    costeIda3: 12,
    costeXbid: 15,
    costeTotalOmie: 90,
    facturaCompra: 180,
    facturaVenta: 210,
    descuadre: -30
  });
  assert.deepEqual(aggregated[0].children[0].aggregates, {
    costeMd: 30,
    costeIda1: 3,
    costeIda2: 5,
    costeIda3: 7,
    costeXbid: 9,
    costeTotalOmie: 50,
    facturaCompra: 90,
    facturaVenta: 110,
    descuadre: -20
  });
  assert.deepEqual(liquidacionRows[0], {
    id: "l1",
    month: "2026-06",
    day: "2026-06-01",
    hour: "01",
    costeMd: 10,
    costeIda1: 1,
    costeIda2: 2,
    costeIda3: 3,
    costeXbid: 4,
    costeTotalOmie: 20,
    facturaCompra: 30,
    facturaVenta: 40,
    descuadre: -10
  });
});

test("aggregateHierarchy and buildHierarchyWithAggregates return empty trees for empty input", () => {
  assert.deepEqual(aggregateHierarchy([], cargaAggregates), []);
  assert.deepEqual(buildHierarchyWithAggregates([], cargaLevels, cargaAggregates), []);
});

