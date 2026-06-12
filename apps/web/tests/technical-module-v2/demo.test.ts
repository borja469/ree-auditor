import assert from "node:assert/strict";
import test from "node:test";

import {
  createTechnicalModuleDemoBackend,
  createTechnicalModuleDemoRuntime,
  resetTechnicalModuleDemoStorage,
  runTechnicalModuleDemoPipeline,
  saveTechnicalModuleDemoSnapshot,
  loadTechnicalModuleDemoSnapshot
} from "../../src/technical-module-v2/demo/index.js";

test("demo pipeline starts with basic preset", () => {
  const view = runTechnicalModuleDemoPipeline({
    preset: "basic",
    hiddenColumns: [],
    filters: { name: "", status: "" },
    sort: null
  });

  assert.deepEqual(view.visibleColumns.map((column) => column.id), ["name", "status"]);
  assert.equal(view.renderedRows[0].name, "Alpha");
});

test("demo pipeline supports advanced preset", () => {
  const view = runTechnicalModuleDemoPipeline({
    preset: "advanced",
    hiddenColumns: [],
    filters: { name: "", status: "" },
    sort: null
  });

  assert.deepEqual(view.visibleColumns.map((column) => column.id), ["name", "status", "region", "amount", "active"]);
});

test("demo pipeline hides and shows a column", () => {
  const runtime = createTechnicalModuleDemoRuntime({
    initialSnapshot: {
      preset: "advanced",
      hiddenColumns: [],
      filters: { name: "", status: "" },
      sort: null
    }
  });

  runtime.toggleColumn("region");
  assert.deepEqual(runtime.view.visibleColumns.map((column) => column.id), ["name", "status", "amount", "active"]);

  runtime.toggleColumn("region");
  assert.deepEqual(runtime.view.visibleColumns.map((column) => column.id), ["name", "status", "region", "amount", "active"]);
});

test("demo pipeline supports text and enum filters", () => {
  const runtime = createTechnicalModuleDemoRuntime({
    initialSnapshot: {
      preset: "advanced",
      hiddenColumns: [],
      filters: { name: "a", status: "OK" },
      sort: null
    }
  });

  assert.deepEqual(runtime.view.sortedRows.map((row) => row.name), ["Alpha", "Charlie"]);

  runtime.setFilter("name", "ch");
  assert.deepEqual(runtime.view.sortedRows.map((row) => row.name), ["Charlie"]);
});

test("demo pipeline supports sort asc and desc", () => {
  const runtime = createTechnicalModuleDemoRuntime({
    initialSnapshot: {
      preset: "advanced",
      hiddenColumns: [],
      filters: { name: "", status: "" },
      sort: null
    }
  });

  runtime.setSort({ columnId: "amount", direction: "asc" });
  assert.deepEqual(runtime.view.sortedRows.map((row) => row.amount), [10, 20, 30, 40, 50]);

  runtime.setSort({ columnId: "amount", direction: "desc" });
  assert.deepEqual(runtime.view.sortedRows.map((row) => row.amount), [50, 40, 30, 20, 10]);
});

test("demo persistence saves and loads the snapshot", () => {
  const backend = createTechnicalModuleDemoBackend();

  const runtime = createTechnicalModuleDemoRuntime({
    backend,
    storageKey: "demo-test",
    initialSnapshot: {
      preset: "advanced",
      hiddenColumns: ["region"],
      filters: { name: "a", status: "WARN" },
      sort: { columnId: "name", direction: "desc" }
    }
  });

  runtime.persist();

  const loaded = loadTechnicalModuleDemoSnapshot(backend, "demo-test");
  assert.deepEqual(loaded, runtime.snapshot);

  runtime.toggleColumn("amount");
  runtime.clearFilters();
  runtime.clearSort();
  const persistedAfterChanges = runtime.snapshot;
  runtime.reload();

  assert.deepEqual(runtime.snapshot, persistedAfterChanges);
});

test("demo storage reset clears the persisted snapshot", () => {
  const backend = createTechnicalModuleDemoBackend();
  saveTechnicalModuleDemoSnapshot(
    backend,
    {
      preset: "basic",
      hiddenColumns: [],
      filters: { name: "", status: "" },
      sort: null
    },
    "demo-reset"
  );

  resetTechnicalModuleDemoStorage(backend, "demo-reset");
  assert.equal(loadTechnicalModuleDemoSnapshot(backend, "demo-reset"), null);
});
