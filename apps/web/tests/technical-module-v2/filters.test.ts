import assert from "node:assert/strict";
import test from "node:test";

import { applyFilters, buildFilterState, clearFilters, getFilterOptions } from "../../src/technical-module-v2/filters/engine.js";
import type { TechnicalFilterDefinition, TechnicalFilterState } from "../../src/technical-module-v2/filters/types.js";

type Row = {
  name: string;
  amount: number;
  day: string;
  status: string;
  active: boolean;
};

const rows: Row[] = [
  { name: "Alpha", amount: 10, day: "2026-06-01", status: "OK", active: true },
  { name: "Beta", amount: 20, day: "2026-06-02", status: "WARN", active: false },
  { name: "Gamma", amount: 30, day: "2026-06-03", status: "OK", active: true },
  { name: "Delta", amount: 40, day: "2026-06-04", status: "FAIL", active: false }
];

const definitions: TechnicalFilterDefinition<Row>[] = [
  { id: "name", type: "text", getValue: (row) => row.name },
  { id: "amount", type: "number", getValue: (row) => row.amount },
  { id: "day", type: "date", getValue: (row) => row.day },
  { id: "status", type: "enum", getValue: (row) => row.status },
  { id: "active", type: "boolean", getValue: (row) => row.active }
];

function filteredIds(state: TechnicalFilterState): string[] {
  return applyFilters(rows, definitions, state).map((row) => row.name);
}

test("buildFilterState creates a stable initial state", () => {
  const state = buildFilterState(definitions);

  assert.deepEqual(state, {
    name: null,
    amount: null,
    day: null,
    status: null,
    active: null
  });
});

test("text filter works", () => {
  assert.deepEqual(filteredIds({ name: "a" }), ["Alpha", "Beta", "Gamma", "Delta"]);
  assert.deepEqual(filteredIds({ name: "mm" }), ["Gamma"]);
});

test("number filter works", () => {
  assert.deepEqual(filteredIds({ amount: { min: 15, max: 35 } }), ["Beta", "Gamma"]);
  assert.deepEqual(filteredIds({ amount: 20 }), ["Beta"]);
});

test("date filter works", () => {
  assert.deepEqual(filteredIds({ day: { from: "2026-06-02", to: "2026-06-03" } }), ["Beta", "Gamma"]);
  assert.deepEqual(filteredIds({ day: "2026-06-04" }), ["Delta"]);
});

test("enum filter works and options are unique", () => {
  assert.deepEqual(filteredIds({ status: "OK" }), ["Alpha", "Gamma"]);

  const options = getFilterOptions(rows, definitions[3]);
  assert.deepEqual(options, [
    { value: "FAIL", label: "FAIL" },
    { value: "OK", label: "OK" },
    { value: "WARN", label: "WARN" }
  ]);
});

test("boolean filter works", () => {
  assert.deepEqual(filteredIds({ active: true }), ["Alpha", "Gamma"]);
  assert.deepEqual(filteredIds({ active: "false" }), ["Beta", "Delta"]);
});

test("multiple filters run together", () => {
  assert.deepEqual(
    filteredIds({
      name: "a",
      amount: { min: 20, max: 40 },
      status: ["OK", "FAIL"],
      active: true
    }),
    ["Gamma"]
  );
});

test("empty filters keep all rows", () => {
  assert.deepEqual(filteredIds(buildFilterState(definitions)), ["Alpha", "Beta", "Gamma", "Delta"]);
});

test("clearFilters resets the state", () => {
  const cleared = clearFilters(definitions);
  assert.deepEqual(cleared, buildFilterState(definitions));
});

test("unknown or empty filter values do not break filtering", () => {
  assert.deepEqual(filteredIds({ missing: "x" }), ["Alpha", "Beta", "Gamma", "Delta"]);
  assert.deepEqual(filteredIds({ name: "" }), ["Alpha", "Beta", "Gamma", "Delta"]);
});

test("edge cases cover non-string text, open-ended ranges and invalid values", () => {
  type EdgeRow = {
    code: unknown;
    amount: unknown;
    day: unknown;
    active: unknown;
    status: unknown;
  };

  const edgeRows: EdgeRow[] = [
    { code: 123, amount: "15", day: new Date("2026-06-01T00:00:00.000Z"), active: "true", status: "OK" },
    { code: 456, amount: "30", day: new Date("2026-06-03T00:00:00.000Z"), active: "false", status: "WARN" },
    { code: 789, amount: "oops", day: new Date("invalid"), active: null, status: "OK" }
  ];

  const edgeDefinitions: TechnicalFilterDefinition<EdgeRow>[] = [
    { id: "code", type: "text", getValue: (row) => row.code },
    { id: "amount", type: "number", getValue: (row) => row.amount },
    { id: "day", type: "date", getValue: (row) => row.day },
    { id: "active", type: "boolean", getValue: (row) => row.active },
    { id: "status", type: "enum", getValue: (row) => row.status }
  ];

  assert.deepEqual(
    applyFilters(edgeRows, edgeDefinitions, {
      code: "123",
      amount: { min: 10 },
      day: { to: "2026-06-02" },
      active: "maybe",
      status: ["OK", "WARN"]
    }).map((row) => row.code),
    [123]
  );

  assert.deepEqual(
    applyFilters(edgeRows, edgeDefinitions, {
      amount: { max: 20 },
      day: { from: new Date("2026-06-01T00:00:00.000Z") },
      active: true,
      status: "OK"
    }).map((row) => row.code),
    [123]
  );

  assert.deepEqual(getFilterOptions(edgeRows, edgeDefinitions[4]), [
    { value: "OK", label: "OK" },
    { value: "WARN", label: "WARN" }
  ]);

  assert.deepEqual(getFilterOptions(edgeRows, edgeDefinitions[3]), [
    { value: false, label: "false" },
    { value: true, label: "true" }
  ]);
});
