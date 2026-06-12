import assert from "node:assert/strict";
import test from "node:test";

import { applySort, buildSortState, clearSort } from "../../src/technical-module-v2/sort/engine.js";
import type { TechnicalSortDefinition } from "../../src/technical-module-v2/sort/types.js";

type Row = {
  name: string | null | undefined;
  amount: number | null | undefined;
  day: string | Date | null | undefined;
  active: boolean | null | undefined;
  rank: number;
};

const rows: Row[] = [
  { name: "beta", amount: 20, day: "2026-06-03", active: true, rank: 1 },
  { name: "Alpha", amount: 10, day: "2026-06-01", active: false, rank: 2 },
  { name: "gamma", amount: 30, day: "2026-06-02", active: true, rank: 3 },
  { name: "alpha", amount: 40, day: "2026-06-04", active: false, rank: 4 },
  { name: null, amount: null, day: null, active: null, rank: 5 },
  { name: undefined, amount: undefined, day: undefined, active: undefined, rank: 6 }
];

const definitions: TechnicalSortDefinition<Row>[] = [
  { id: "name", getValue: (row) => row.name },
  { id: "amount", getValue: (row) => row.amount },
  { id: "day", getValue: (row) => row.day },
  { id: "active", getValue: (row) => row.active },
  { id: "rank", getValue: (row) => row.rank }
];

function ids(sorted: Row[]): number[] {
  return sorted.map((row) => row.rank);
}

test("sort state builder and clearSort work", () => {
  assert.equal(buildSortState(), null);
  assert.deepEqual(buildSortState("name", "asc"), { columnId: "name", direction: "asc" });
  assert.equal(clearSort(), null);
});

test("string asc is case insensitive and stable", () => {
  const sorted = applySort(rows, definitions, { columnId: "name", direction: "asc" });

  assert.deepEqual(ids(sorted), [5, 6, 2, 4, 1, 3]);
  assert.deepEqual(sorted, [...sorted]);
});

test("string desc is case insensitive and stable", () => {
  const sorted = applySort(rows, definitions, { columnId: "name", direction: "desc" });

  assert.deepEqual(ids(sorted), [3, 1, 2, 4, 5, 6]);
});

test("number asc sorts numerically", () => {
  const sorted = applySort(rows, definitions, { columnId: "amount", direction: "asc" });

  assert.deepEqual(ids(sorted), [5, 6, 2, 1, 3, 4]);
});

test("number desc sorts numerically", () => {
  const sorted = applySort(rows, definitions, { columnId: "amount", direction: "desc" });

  assert.deepEqual(ids(sorted), [4, 3, 1, 2, 5, 6]);
});

test("date asc sorts chronologically", () => {
  const sorted = applySort(rows, definitions, { columnId: "day", direction: "asc" });

  assert.deepEqual(ids(sorted), [5, 6, 2, 3, 1, 4]);
});

test("date desc sorts chronologically", () => {
  const sorted = applySort(rows, definitions, { columnId: "day", direction: "desc" });

  assert.deepEqual(ids(sorted), [4, 1, 3, 2, 5, 6]);
});

test("boolean sorts false before true", () => {
  const sorted = applySort(rows, definitions, { columnId: "active", direction: "asc" });

  assert.deepEqual(ids(sorted), [2, 4, 1, 3, 5, 6]);
});

test("null asc behaves like an empty string or zero depending on the column type", () => {
  assert.deepEqual(
    ids(applySort(rows, definitions, { columnId: "name", direction: "asc" })),
    [5, 6, 2, 4, 1, 3]
  );
  assert.deepEqual(
    ids(applySort(rows, definitions, { columnId: "amount", direction: "asc" })),
    [5, 6, 2, 1, 3, 4]
  );
  assert.deepEqual(
    ids(applySort(rows, definitions, { columnId: "day", direction: "asc" })),
    [5, 6, 2, 3, 1, 4]
  );
});

test("null desc stays last for strings, numbers and dates", () => {
  assert.deepEqual(
    ids(applySort(rows, definitions, { columnId: "name", direction: "desc" })),
    [3, 1, 2, 4, 5, 6]
  );
  assert.deepEqual(
    ids(applySort(rows, definitions, { columnId: "amount", direction: "desc" })),
    [4, 3, 1, 2, 5, 6]
  );
  assert.deepEqual(
    ids(applySort(rows, definitions, { columnId: "day", direction: "desc" })),
    [4, 1, 3, 2, 5, 6]
  );
});

test("undefined asc behaves like an empty string or zero depending on the column type", () => {
  const undefinedRows = [
    { name: "zeta", amount: 9, day: "2026-06-03", active: true, rank: 1 },
    { name: undefined, amount: undefined, day: undefined, active: undefined, rank: 2 },
    { name: "alpha", amount: 1, day: "2026-06-01", active: false, rank: 3 }
  ];

  const sorted = applySort(undefinedRows, definitions, { columnId: "name", direction: "asc" });
  assert.deepEqual(ids(sorted as Row[]), [2, 3, 1]);
});

test("undefined desc stays last", () => {
  const undefinedRows = [
    { name: "zeta", amount: 9, day: "2026-06-03", active: true, rank: 1 },
    { name: undefined, amount: undefined, day: undefined, active: undefined, rank: 2 },
    { name: "alpha", amount: 1, day: "2026-06-01", active: false, rank: 3 }
  ];

  const sorted = applySort(undefinedRows, definitions, { columnId: "name", direction: "desc" });
  assert.deepEqual(ids(sorted as Row[]), [1, 3, 2]);
});

test("mixed number and null values keep null first in asc and last in desc", () => {
  const mixedRows = [
    { amount: null, rank: 1 },
    { amount: 20, rank: 2 },
    { amount: 10, rank: 3 }
  ] as Array<{ amount: number | null; rank: number }>;

  const mixedDefinitions: TechnicalSortDefinition<(typeof mixedRows)[number]>[] = [
    { id: "amount", getValue: (row) => row.amount, type: "number" },
    { id: "rank", getValue: (row) => row.rank, type: "number" }
  ];

  assert.deepEqual(
    applySort(mixedRows, mixedDefinitions, { columnId: "amount", direction: "asc" }).map((row) => row.rank),
    [1, 3, 2]
  );
  assert.deepEqual(
    applySort(mixedRows, mixedDefinitions, { columnId: "amount", direction: "desc" }).map((row) => row.rank),
    [2, 3, 1]
  );
});

test("mixed date and null values keep null first in asc and last in desc", () => {
  const mixedRows = [
    { day: null, rank: 1 },
    { day: "2026-06-02", rank: 2 },
    { day: "2026-06-01", rank: 3 }
  ] as Array<{ day: string | null; rank: number }>;

  const mixedDefinitions: TechnicalSortDefinition<(typeof mixedRows)[number]>[] = [
    { id: "day", getValue: (row) => row.day, type: "date" },
    { id: "rank", getValue: (row) => row.rank, type: "number" }
  ];

  assert.deepEqual(
    applySort(mixedRows, mixedDefinitions, { columnId: "day", direction: "asc" }).map((row) => row.rank),
    [1, 3, 2]
  );
  assert.deepEqual(
    applySort(mixedRows, mixedDefinitions, { columnId: "day", direction: "desc" }).map((row) => row.rank),
    [2, 3, 1]
  );
});

test("mixed string and null values keep null first in asc and last in desc", () => {
  const mixedRows = [
    { name: null, rank: 1 },
    { name: "beta", rank: 2 },
    { name: "alpha", rank: 3 }
  ] as Array<{ name: string | null; rank: number }>;

  const mixedDefinitions: TechnicalSortDefinition<(typeof mixedRows)[number]>[] = [
    { id: "name", getValue: (row) => row.name, type: "text" },
    { id: "rank", getValue: (row) => row.rank, type: "number" }
  ];

  assert.deepEqual(
    applySort(mixedRows, mixedDefinitions, { columnId: "name", direction: "asc" }).map((row) => row.rank),
    [1, 3, 2]
  );
  assert.deepEqual(
    applySort(mixedRows, mixedDefinitions, { columnId: "name", direction: "desc" }).map((row) => row.rank),
    [2, 3, 1]
  );
});

test("sort is stable for equal values", () => {
  const equalRows = [
    { name: "same", amount: 1, day: "2026-06-01", active: true, rank: 1 },
    { name: "same", amount: 2, day: "2026-06-02", active: false, rank: 2 },
    { name: "same", amount: 3, day: "2026-06-03", active: true, rank: 3 }
  ];

  const sorted = applySort(equalRows, definitions, { columnId: "name", direction: "asc" });
  assert.deepEqual(ids(sorted as Row[]), [1, 2, 3]);
});

test("unknown columns return a copy without changing order", () => {
  const sorted = applySort(rows, definitions, { columnId: "missing", direction: "asc" });

  assert.deepEqual(ids(sorted), ids(rows));
  assert.notStrictEqual(sorted, rows);
});

test("empty sort returns a copy without changing order", () => {
  const sorted = applySort(rows, definitions, null);

  assert.deepEqual(ids(sorted), ids(rows));
  assert.notStrictEqual(sorted, rows);
});

test("other values are sorted deterministically as strings", () => {
  const weirdRows = [
    { name: { label: "b" }, amount: 1, day: "2026-06-01", active: true, rank: 1 },
    { name: { label: "a" }, amount: 2, day: "2026-06-02", active: false, rank: 2 }
  ] as Array<Row & { name: { label: string } }>;

  const weirdDefinitions: TechnicalSortDefinition<(typeof weirdRows)[number]>[] = [
    { id: "name", getValue: (row) => row.name },
    { id: "amount", getValue: (row) => row.amount },
    { id: "day", getValue: (row) => row.day },
    { id: "active", getValue: (row) => row.active },
    { id: "rank", getValue: (row) => row.rank }
  ];

  const sorted = applySort(weirdRows, weirdDefinitions, { columnId: "name", direction: "asc" });
  assert.deepEqual(ids(sorted as Row[]), [1, 2]);
});

test("invalid Date objects are treated like nullish and stay last", () => {
  const invalidDateRows = [
    { name: "x", amount: 1, day: new Date("invalid"), active: true, rank: 1 },
    { name: "y", amount: 2, day: "2026-06-01", active: false, rank: 2 }
  ];

  const invalidDateDefinitions: TechnicalSortDefinition<(typeof invalidDateRows)[number]>[] = [
    { id: "name", getValue: (row) => row.name },
    { id: "amount", getValue: (row) => row.amount },
    { id: "day", getValue: (row) => row.day },
    { id: "active", getValue: (row) => row.active },
    { id: "rank", getValue: (row) => row.rank }
  ];

  const sorted = applySort(invalidDateRows, invalidDateDefinitions, { columnId: "day", direction: "asc" });
  assert.deepEqual(ids(sorted as Row[]), [2, 1]);
});

test("mixed primitive kinds are ordered deterministically", () => {
  const mixedRows = [
    { value: true, rank: 1 },
    { value: 2, rank: 2 },
    { value: "a", rank: 3 },
    { value: new Date("2026-06-01T00:00:00.000Z"), rank: 4 }
  ];

  const mixedDefinitions: TechnicalSortDefinition<(typeof mixedRows)[number]>[] = [
    { id: "value", getValue: (row) => row.value },
    { id: "rank", getValue: (row) => row.rank }
  ];

  const sorted = applySort(mixedRows, mixedDefinitions, { columnId: "value", direction: "asc" });
  assert.deepEqual(sorted.map((row) => row.rank), [2, 3, 4, 1]);
});
