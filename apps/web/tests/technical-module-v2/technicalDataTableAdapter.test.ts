import assert from "node:assert/strict";
import test from "node:test";

import { createTechnicalDataTableAdapter } from "../../src/technical-module-v2/adapters/technicalDataTableAdapter.js";
import { createTechnicalPreferencesStorage } from "../../src/technical-module-v2/persistence/storage.js";
import type { TechnicalPreferencesStorageBackend } from "../../src/technical-module-v2/persistence/types.js";

type Row = {
  id: string;
  name: string;
  status: "OK" | "WARN" | "FAIL";
  region: string;
  amount: number;
  date: string;
};

function createMemoryBackend(): TechnicalPreferencesStorageBackend {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
}

const rows: Row[] = [
  { id: "r1", name: "Alpha", status: "OK", region: "North", amount: 20, date: "2026-06-01" },
  { id: "r2", name: "Bravo", status: "WARN", region: "West", amount: 40, date: "2026-06-02" },
  { id: "r3", name: "Charlie", status: "OK", region: "South", amount: 10, date: "2026-06-03" }
];

const columns = [
  { id: "name", label: "Name", width: 100, visibility: "basic" as const, filter: "text" as const, value: (row: Row) => row.name },
  { id: "status", label: "Status", width: 80, visibility: "basic" as const, filter: "select" as const, value: (row: Row) => row.status },
  { id: "region", label: "Region", width: 90, visibility: "advanced" as const, filter: "text" as const, value: (row: Row) => row.region },
  { id: "amount", label: "Amount", width: 70, visibility: "advanced" as const, type: "number" as const, filter: "number" as const, value: (row: Row) => row.amount },
  { id: "date", label: "Date", width: 90, visibility: "basic" as const, type: "date" as const, value: (row: Row) => row.date }
];

test("adapter resolves basic preset and visible columns", () => {
  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: {
      mode: "basic",
      search: "",
      filters: {}
    }
  });

  assert.deepEqual(adapter.activeColumns.map((column) => column.id), ["name", "status", "date"]);
  assert.deepEqual(adapter.visibleColumns.map((column) => column.sourceId), ["name", "status", "date"]);
});

test("adapter resolves advanced preset", () => {
  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: {
      mode: "advanced",
      search: "",
      filters: {}
    }
  });

  assert.deepEqual(adapter.activeColumns.map((column) => column.id), ["name", "status", "region", "amount", "date"]);
});

test("adapter applies filters and search", () => {
  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: {
      mode: "advanced",
      search: "alp",
      filters: {
        name: "a",
        status: "OK"
      }
    }
  });

  assert.deepEqual(adapter.filteredRows.map((row) => row.id), ["r1", "r3"]);
  assert.deepEqual(adapter.searchRows.map((row) => row.id), ["r1"]);
});

test("adapter applies number sort asc and desc", () => {
  const ascAdapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: {
      mode: "advanced",
      search: "",
      filters: {},
      sort: { columnId: "amount", direction: "asc" }
    }
  });

  const descAdapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    state: {
      mode: "advanced",
      search: "",
      filters: {},
      sort: { columnId: "amount", direction: "desc" }
    }
  });

  assert.deepEqual(ascAdapter.sortedRows.map((row) => row.id), ["r3", "r1", "r2"]);
  assert.deepEqual(descAdapter.sortedRows.map((row) => row.id), ["r2", "r1", "r3"]);
});

test("adapter persists and reloads preferences", () => {
  const backend = createMemoryBackend();
  const storage = createTechnicalPreferencesStorage({ backend, version: 1, keyPrefix: "demo" });

  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    preferences: {
      key: "table",
      storage,
      version: 1
    },
    state: {
      mode: "advanced",
      search: "alpha",
      filters: { name: "alpha" },
      hiddenColumns: ["region"],
      sort: { columnId: "name", direction: "asc" }
    }
  });

  adapter.persist();

  const reloaded = createTechnicalDataTableAdapter({
    rows,
    columns,
    preferences: {
      key: "table",
      storage,
      version: 1
    }
  });

  assert.equal(reloaded.state.mode, "advanced");
  assert.deepEqual(reloaded.state.hiddenColumns, ["region"]);
  assert.deepEqual(reloaded.state.filters, { name: "alpha" });
  assert.deepEqual(reloaded.state.sort, { columnId: "name", direction: "asc" });
});

test("adapter keeps compatibility with showModeSelector disabled", () => {
  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns,
    showModeSelector: false
  });

  assert.equal(adapter.state.mode, "advanced");
  assert.deepEqual(adapter.activeColumns.map((column) => column.id), ["name", "status", "region", "amount", "date"]);
});

test("adapter preserves defaultHidden as metadata without changing current visibility rules", () => {
  const adapter = createTechnicalDataTableAdapter({
    rows,
    columns: columns.map((column) =>
      column.id === "region" ? { ...column, defaultHidden: true } : column
    ),
    state: {
      mode: "advanced",
      search: "",
      filters: {}
    }
  });

  assert.equal(adapter.v2Columns.find((column) => column.sourceId === "region")?.sourceDefaultHidden, true);
  assert.deepEqual(adapter.activeColumns.map((column) => column.id), ["name", "status", "region", "amount", "date"]);
});
