import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateColumns,
  aggregateRows,
  buildAggregateRow
} from "../../src/technical-module-v2/index.js";
import type { TechnicalAggregateColumnDefinition, TechnicalAggregateDefinition } from "../../src/technical-module-v2/index.js";

type TechnicalRow = {
  id: string;
  programaMd: number | null | undefined;
  volIda1: number | null | undefined;
  volIda2: number | null | undefined;
  volIda3: number | null | undefined;
  volXbid: number | null | undefined;
  profitTotal: number | null | undefined;
  costeMd: number | null | undefined;
  costeIda1: number | null | undefined;
  costeIda2: number | null | undefined;
  costeIda3: number | null | undefined;
  costeXbid: number | null | undefined;
  label: string;
};

const rows: TechnicalRow[] = [
  {
    id: "r1",
    programaMd: 10,
    volIda1: 1,
    volIda2: 2,
    volIda3: 3,
    volXbid: 4,
    profitTotal: 100,
    costeMd: 50,
    costeIda1: 5,
    costeIda2: 6,
    costeIda3: 7,
    costeXbid: 8,
    label: "alpha"
  },
  {
    id: "r2",
    programaMd: 20,
    volIda1: null,
    volIda2: 4,
    volIda3: Number.NaN,
    volXbid: 5,
    profitTotal: 200,
    costeMd: 60,
    costeIda1: 10,
    costeIda2: 11,
    costeIda3: 12,
    costeXbid: 13,
    label: "beta"
  },
  {
    id: "r3",
    programaMd: undefined,
    volIda1: 3,
    volIda2: undefined,
    volIda3: 6,
    volXbid: 7,
    profitTotal: null,
    costeMd: 70,
    costeIda1: 15,
    costeIda2: 16,
    costeIda3: 17,
    costeXbid: 18,
    label: "gamma"
  }
];

const aggregateDefinitions: Array<TechnicalAggregateColumnDefinition<TechnicalRow>> = [
  { id: "programaMd", aggregate: { kind: "sum", getValue: (row) => row.programaMd } },
  { id: "volIda1", aggregate: { kind: "sum", getValue: (row) => row.volIda1 } },
  { id: "volIda2", aggregate: { kind: "sum", getValue: (row) => row.volIda2 } },
  { id: "volIda3", aggregate: { kind: "sum", getValue: (row) => row.volIda3 } },
  { id: "volXbid", aggregate: { kind: "sum", getValue: (row) => row.volXbid } },
  { id: "profitTotal", aggregate: { kind: "sum", getValue: (row) => row.profitTotal } },
  { id: "costeMd", aggregate: { kind: "sum", getValue: (row) => row.costeMd } },
  { id: "costeIda1", aggregate: { kind: "sum", getValue: (row) => row.costeIda1 } },
  { id: "costeIda2", aggregate: { kind: "sum", getValue: (row) => row.costeIda2 } },
  { id: "costeIda3", aggregate: { kind: "sum", getValue: (row) => row.costeIda3 } },
  { id: "costeXbid", aggregate: { kind: "sum", getValue: (row) => row.costeXbid } },
  { id: "countRows", aggregate: "count" },
  { id: "avgProfit", aggregate: { kind: "avg", getValue: (row) => row.profitTotal } },
  { id: "minVolXbid", aggregate: { kind: "min", getValue: (row) => row.volXbid } },
  { id: "maxProgramaMd", aggregate: { kind: "max", getValue: (row) => row.programaMd } },
  {
    id: "customLabel",
    aggregate: {
      kind: "custom",
      calculate: (currentRows) => currentRows.map((row) => row.label.toUpperCase()).join(", ")
    }
  }
];

function getAggregatedRow() {
  return buildAggregateRow(rows, aggregateDefinitions);
}

test("sum ignores null, undefined and NaN", () => {
  const result = aggregateRows(rows, { kind: "sum", getValue: (row: TechnicalRow) => row.volIda1 });

  assert.equal(result, 4);
});

test("avg ignores null, undefined and NaN", () => {
  const result = aggregateRows(rows, { kind: "avg", getValue: (row: TechnicalRow) => row.profitTotal });

  assert.equal(result, 150);
});

test("count ignores null, undefined and NaN when a value extractor exists", () => {
  const result = aggregateRows(rows, { kind: "count", getValue: (row: TechnicalRow) => row.profitTotal });

  assert.equal(result, 2);
});

test("count without a value extractor counts rows", () => {
  const result = aggregateRows(rows, "count");

  assert.equal(result, 3);
});

test("min ignores null, undefined and NaN", () => {
  const result = aggregateRows(rows, { kind: "min", getValue: (row: TechnicalRow) => row.volXbid });

  assert.equal(result, 4);
});

test("max ignores null, undefined and NaN", () => {
  const result = aggregateRows(rows, { kind: "max", getValue: (row: TechnicalRow) => row.programaMd });

  assert.equal(result, 20);
});

test("custom calculations receive all rows", () => {
  const result = aggregateRows(rows, {
    kind: "custom",
    calculate: (currentRows) => currentRows.length
  });

  assert.equal(result, 3);
});

test("missing aggregate definitions return undefined", () => {
  assert.equal(aggregateRows(rows, undefined), undefined);
  assert.equal(aggregateRows(rows, null), undefined);
});

test("custom aggregates without calculate return undefined", () => {
  assert.equal(aggregateRows(rows, { kind: "custom" }), undefined);
});

test("empty arrays return stable values for numeric aggregates", () => {
  const emptyRows: TechnicalRow[] = [];

  assert.equal(aggregateRows(emptyRows, { kind: "sum", getValue: (row) => row.volIda1 }), 0);
  assert.equal(aggregateRows(emptyRows, { kind: "avg", getValue: (row) => row.volIda1 }), null);
  assert.equal(aggregateRows(emptyRows, "count"), 0);
  assert.equal(aggregateRows(emptyRows, { kind: "min", getValue: (row) => row.volIda1 }), null);
  assert.equal(aggregateRows(emptyRows, { kind: "max", getValue: (row) => row.volIda1 }), null);
});

test("aggregateColumns returns a map keyed by column id", () => {
  const result = aggregateColumns(rows, aggregateDefinitions);

  assert.deepEqual(result, {
    programaMd: 30,
    volIda1: 4,
    volIda2: 6,
    volIda3: 9,
    volXbid: 16,
    profitTotal: 300,
    costeMd: 180,
    costeIda1: 30,
    costeIda2: 33,
    costeIda3: 36,
    costeXbid: 39,
    countRows: 3,
    avgProfit: 150,
    minVolXbid: 4,
    maxProgramaMd: 20,
    customLabel: "ALPHA, BETA, GAMMA"
  });
});

test("aggregateColumns skips columns without aggregate definitions", () => {
  const result = aggregateColumns(rows, [
    { id: "programaMd", aggregate: { kind: "sum", getValue: (row: TechnicalRow) => row.programaMd } },
    { id: "label" },
    { id: "countRows", aggregate: "count" }
  ]);

  assert.deepEqual(result, {
    programaMd: 30,
    countRows: 3
  });
});

test("buildAggregateRow mirrors aggregateColumns for row output", () => {
  assert.deepEqual(getAggregatedRow(), aggregateColumns(rows, aggregateDefinitions));
});

test("multiple column aggregates stay isolated from each other", () => {
  const result = buildAggregateRow(rows, [
    { id: "sumA", aggregate: { kind: "sum", getValue: (row: TechnicalRow) => row.volIda1 } },
    { id: "sumB", aggregate: { kind: "sum", getValue: (row: TechnicalRow) => row.costeIda1 } },
    { id: "count", aggregate: "count" }
  ]);

  assert.deepEqual(result, {
    sumA: 4,
    sumB: 30,
    count: 3
  });
});

test("aggregateRows accepts string shorthand for numeric sums", () => {
  const result = aggregateRows([10, 20, 30], "sum");

  assert.equal(result, 60);
});

test("numeric aggregates without a value extractor only use primitive rows", () => {
  assert.equal(aggregateRows(rows, { kind: "sum" }), 0);
  assert.equal(aggregateRows(rows, { kind: "avg" }), null);
  assert.equal(aggregateRows(rows, { kind: "min" }), null);
  assert.equal(aggregateRows(rows, { kind: "max" }), null);
});

test("custom aggregates can return structured values", () => {
  const definition: TechnicalAggregateDefinition<TechnicalRow> = {
    kind: "custom",
    calculate: (currentRows) => ({
      rows: currentRows.length,
      ids: currentRows.map((row) => row.id)
    })
  };

  const result = aggregateRows(rows, definition);

  assert.deepEqual(result, {
    rows: 3,
    ids: ["r1", "r2", "r3"]
  });
});
