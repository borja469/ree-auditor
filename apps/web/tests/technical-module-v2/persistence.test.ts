import assert from "node:assert/strict";
import test from "node:test";

import { createTechnicalPreferencesStorage } from "../../src/technical-module-v2/persistence/storage.js";
import { normalizeTechnicalPreferencesState } from "../../src/technical-module-v2/persistence/state.js";
import type { TechnicalPreferencesStorageBackend } from "../../src/technical-module-v2/persistence/types.js";
import type { TechnicalPreferencesState } from "../../src/technical-module-v2/types.js";

function createMemoryBackend(initial: Record<string, string> = {}): TechnicalPreferencesStorageBackend {
  const values = new Map<string, string>(Object.entries(initial));

  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

test("normalizeTechnicalPreferencesState applies safe defaults", () => {
  const state = normalizeTechnicalPreferencesState({
    preset: "advanced",
    hiddenColumns: ["a", 1 as unknown as string],
    columnOrder: ["x"],
    filters: { foo: "bar", skip: 1 as unknown as string },
    expandedGroups: ["g1"],
    density: "compact"
  });

  assert.equal(state.preset, "advanced");
  assert.deepEqual(state.hiddenColumns, ["a"]);
  assert.deepEqual(state.columnOrder, ["x"]);
  assert.deepEqual(state.filters, { foo: "bar" });
  assert.deepEqual(state.expandedGroups, ["g1"]);
  assert.equal(state.density, "compact");
});

test("createTechnicalPreferencesStorage saves and loads versioned state", () => {
  const backend = createMemoryBackend();
  const storage = createTechnicalPreferencesStorage({
    backend,
    version: 2,
    keyPrefix: "ui"
  });

  const input: TechnicalPreferencesState = {
    preset: "advanced",
    hiddenColumns: ["foo"],
    columnOrder: ["foo"],
    filters: { q: "abc" },
    expandedGroups: ["group-1"],
    density: "regular",
    sort: { id: "foo", direction: "desc" },
    columnWidths: { foo: 120 }
  };

  storage.save("table", input);

  assert.deepEqual(JSON.parse(backend.getItem("ui:table") ?? "null"), {
    version: 2,
    state: input
  });

  const loaded = storage.load("table");
  assert.deepEqual(loaded, input);
});

test("createTechnicalPreferencesStorage migrates legacy state", () => {
  const backend = createMemoryBackend({
    "ui:table": JSON.stringify({
      version: 0,
      state: {
        preset: "basic",
        hiddenColumns: ["legacy"],
        columnOrder: ["legacy"],
        filters: { month: "2026-06" },
        expandedGroups: ["day-1"],
        density: "regular"
      }
    })
  });

  const storage = createTechnicalPreferencesStorage({
    backend,
    version: 2,
    keyPrefix: "ui",
    migrations: [
      {
        from: 0,
        to: 1,
        migrate: (state) => ({
          ...state,
          filters: {
            ...state.filters,
            migrated: "yes"
          }
        })
      },
      {
        from: 1,
        to: 2,
        migrate: (state) => ({
          ...state,
          hiddenColumns: [...state.hiddenColumns, "v2"]
        })
      }
    ]
  });

  const migrated = storage.migrate(
    {
      version: 0,
      state: {
        preset: "basic",
        hiddenColumns: ["legacy"],
        columnOrder: ["legacy"],
        filters: { month: "2026-06" },
        expandedGroups: ["day-1"],
        density: "regular"
      }
    },
    2
  );

  assert.equal(migrated?.version, 2);
  assert.deepEqual(migrated?.state.hiddenColumns, ["legacy", "v2"]);
  assert.deepEqual(migrated?.state.filters, { month: "2026-06", migrated: "yes" });

  const loaded = storage.load("table");
  assert.deepEqual(loaded, migrated?.state);
});

test("createTechnicalPreferencesStorage clears persisted state", () => {
  const backend = createMemoryBackend({
    "table": JSON.stringify({
      version: 1,
      state: {
        preset: "basic",
        hiddenColumns: [],
        columnOrder: [],
        filters: {},
        expandedGroups: [],
        density: "regular"
      }
    })
  });

  const storage = createTechnicalPreferencesStorage({ backend });
  storage.clear("table");

  assert.equal(backend.getItem("table"), null);
});
