import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPreset,
  getVisibleColumns,
  resetToPreset,
  toggleColumn
} from "../../src/technical-module-v2/columns/engine.js";
import type { TechnicalColumnDefinition, TechnicalColumnVisibilityState } from "../../src/technical-module-v2/columns/types.js";

const baseColumns: TechnicalColumnDefinition[] = [
  { id: "program", label: "Programa", presets: ["basic", "advanced", "audit"] },
  { id: "profit", label: "Profit", presets: ["advanced", "audit"] },
  { id: "audit-flag", label: "Audit Flag", presets: ["audit"] },
  { id: "hidden-default", label: "Hidden default", hiddenByDefault: true },
  { id: "shared", label: "Shared" }
];

function visibleIds(state: TechnicalColumnVisibilityState): string[] {
  return getVisibleColumns(baseColumns, state).map((column) => column.id);
}

test("getVisibleColumns respects basic preset columns", () => {
  const state = resetToPreset(baseColumns, "basic");

  assert.deepEqual(visibleIds(state), ["program", "shared"]);
});

test("getVisibleColumns respects advanced preset columns", () => {
  const state = resetToPreset(baseColumns, "advanced");

  assert.deepEqual(visibleIds(state), ["program", "profit", "shared"]);
});

test("hidden by default columns stay hidden until toggled", () => {
  const state = resetToPreset(baseColumns, "advanced");
  assert.deepEqual(visibleIds(state), ["program", "profit", "shared"]);

  const opened = toggleColumn(baseColumns, state, "hidden-default");
  assert.deepEqual(visibleIds(opened), ["program", "profit", "hidden-default", "shared"]);
});

test("toggleColumn ignores missing columns", () => {
  const state = resetToPreset(baseColumns, "basic");
  const nextState = toggleColumn(baseColumns, state, "missing");

  assert.deepEqual(nextState, state);
});

test("resetToPreset clears customizations", () => {
  const state = resetToPreset(baseColumns, "advanced");
  const toggled = toggleColumn(baseColumns, state, "shared");
  assert.deepEqual(visibleIds(toggled), ["program", "profit"]);

  const reset = resetToPreset(baseColumns, "advanced");
  assert.deepEqual(visibleIds(reset), ["program", "profit", "shared"]);
});

test("applyPreset preserves valid overrides and supports future presets", () => {
  const state = applyPreset(baseColumns, "audit");
  assert.deepEqual(visibleIds(state), ["program", "profit", "audit-flag", "shared"]);

  const toggled = toggleColumn(baseColumns, state, "profit");
  assert.deepEqual(visibleIds(toggled), ["program", "audit-flag", "shared"]);

  const next = applyPreset(baseColumns, "audit", toggled);
  assert.deepEqual(visibleIds(next), ["program", "audit-flag", "shared"]);
});
