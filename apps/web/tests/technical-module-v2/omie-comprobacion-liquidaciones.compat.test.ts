import assert from "node:assert/strict";
import test from "node:test";

import { buildHierarchyWithAggregates } from "../../src/technical-module-v2/index.js";
import type {
  TechnicalAggregateColumnDefinition,
  TechnicalHierarchyLevel
} from "../../src/technical-module-v2/index.js";

type LiquidationRow = {
  id: string;
  month: string;
  day: string;
  fecha: string;
  fechaIso: string;
  costeTotalOmie: number | null;
  facturaCompra: number | null;
  facturaVenta: number | null;
};

type LiquidationDayGroup = {
  key: string;
  label: string;
  rows: LiquidationRow[];
  totals: {
    costeTotalOmie: number | null;
    facturaCompra: number | null;
    facturaVenta: number | null;
    descuadre: number | null;
  };
};

type LiquidationMonthGroup = {
  key: string;
  label: string;
  days: LiquidationDayGroup[];
  totals: {
    rowCount: number;
    costeTotalOmie: number | null;
    facturaCompra: number | null;
    facturaVenta: number | null;
    descuadre: number | null;
  };
};

const rows: LiquidationRow[] = [
  { id: "r4", month: "2026-07", day: "2026-07-01", fecha: "01/07/2026", fechaIso: "2026-07-01", costeTotalOmie: 40, facturaCompra: 44, facturaVenta: 4 },
  { id: "r2", month: "2026-06", day: "2026-06-02", fecha: "02/06/2026", fechaIso: "2026-06-02", costeTotalOmie: 20, facturaCompra: 22, facturaVenta: 2 },
  { id: "r1", month: "2026-06", day: "2026-06-01", fecha: "01/06/2026", fechaIso: "2026-06-01", costeTotalOmie: 10, facturaCompra: 11, facturaVenta: 1 },
  { id: "r5", month: "2026-07", day: "2026-07-02", fecha: "02/07/2026", fechaIso: "2026-07-02", costeTotalOmie: 50, facturaCompra: 55, facturaVenta: 5 },
  { id: "r3", month: "2026-06", day: "2026-06-03", fecha: "03/06/2026", fechaIso: "2026-06-03", costeTotalOmie: 30, facturaCompra: 33, facturaVenta: 3 }
];

const hierarchyLevels: TechnicalHierarchyLevel<LiquidationRow>[] = [
  {
    id: "month",
    getKey: (row) => row.month,
    getLabel: (row) => formatMonthKeyLabel(row.month)
  },
  {
    id: "day",
    getKey: (row) => row.day,
    getLabel: (row) => row.fecha
  }
];

const hierarchyAggregates: Array<TechnicalAggregateColumnDefinition<LiquidationRow>> = [
  { id: "rowCount", aggregate: "count" },
  { id: "costeTotalOmie", aggregate: { kind: "custom", calculate: (currentRows) => sumDefined(currentRows.map((row) => row.costeTotalOmie)) } },
  { id: "facturaCompra", aggregate: { kind: "custom", calculate: (currentRows) => sumDefined(currentRows.map((row) => row.facturaCompra)) } },
  { id: "facturaVenta", aggregate: { kind: "custom", calculate: (currentRows) => sumDefined(currentRows.map((row) => row.facturaVenta)) } }
];

function sortRows(input: LiquidationRow[]) {
  return [...input].sort((left, right) => left.month.localeCompare(right.month) || left.day.localeCompare(right.day) || left.id.localeCompare(right.id));
}

function sumDefined(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function calculateMismatch(costeTotalOmie: number | null, facturaCompra: number | null, facturaVenta: number | null) {
  if (costeTotalOmie === null || facturaCompra === null || facturaVenta === null) {
    return null;
  }

  return round((costeTotalOmie * 1.21) - facturaCompra + facturaVenta);
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[1]}` : value;
}

function buildLegacyHierarchy(input: LiquidationRow[], sortDirection: "asc" | "desc") {
  const sorted = sortRows(input);
  const monthGroups = new Map<string, Map<string, LiquidationRow[]>>();
  const monthOrder: string[] = [];
  const dayOrderByMonth = new Map<string, string[]>();

  for (const row of sorted) {
    if (!monthGroups.has(row.month)) {
      monthGroups.set(row.month, new Map<string, LiquidationRow[]>());
      monthOrder.push(row.month);
      dayOrderByMonth.set(row.month, []);
    }

    const dayGroups = monthGroups.get(row.month) as Map<string, LiquidationRow[]>;
    const dayOrder = dayOrderByMonth.get(row.month) as string[];
    if (!dayGroups.has(row.day)) {
      dayGroups.set(row.day, []);
      dayOrder.push(row.day);
    }
    dayGroups.get(row.day)?.push(row);
  }

  const monthKeys = sortDirection === "asc" ? monthOrder : [...monthOrder].reverse();
  return monthKeys.map((month) => {
    const dayGroups = monthGroups.get(month) as Map<string, LiquidationRow[]>;
    const dayKeys = sortDirection === "asc" ? [...(dayOrderByMonth.get(month) ?? [])] : [...(dayOrderByMonth.get(month) ?? [])].reverse();
    const days = dayKeys.map((day) => {
      const dayRows = [...(dayGroups.get(day) ?? [])];
      const totals = buildTotals(dayRows);
      return {
        key: day,
        label: dayRows[0]?.fecha ?? day,
        rows: dayRows,
        totals
      };
    });

    return {
      key: month,
      label: formatMonthKeyLabel(month),
      days,
      totals: buildMonthTotals(days)
    } satisfies LiquidationMonthGroup;
  });
}

function buildV2Hierarchy(input: LiquidationRow[], sortDirection: "asc" | "desc") {
  const hierarchy = buildHierarchyWithAggregates(sortRows(input), hierarchyLevels, hierarchyAggregates);
  const monthNodes = sortDirection === "asc" ? hierarchy : [...hierarchy].reverse();

  return monthNodes.map((monthNode) => {
    const dayNodes = sortDirection === "asc" ? monthNode.children : [...monthNode.children].reverse();
    const days = dayNodes.map((dayNode) => ({
      key: dayNode.key,
      label: dayNode.label,
      rows: [...dayNode.rows],
      totals: {
        costeTotalOmie: numberValue(dayNode.aggregates!.costeTotalOmie),
        facturaCompra: numberValue(dayNode.aggregates!.facturaCompra),
        facturaVenta: numberValue(dayNode.aggregates!.facturaVenta),
        descuadre: calculateMismatch(
          numberValue(dayNode.aggregates!.costeTotalOmie),
          numberValue(dayNode.aggregates!.facturaCompra),
          numberValue(dayNode.aggregates!.facturaVenta)
        )
      }
    }));

    return {
      key: monthNode.key,
      label: monthNode.label,
      days,
      totals: {
        rowCount: numberValue(monthNode.aggregates!.rowCount) ?? 0,
        costeTotalOmie: numberValue(monthNode.aggregates!.costeTotalOmie),
        facturaCompra: numberValue(monthNode.aggregates!.facturaCompra),
        facturaVenta: numberValue(monthNode.aggregates!.facturaVenta),
        descuadre: calculateMismatch(
          numberValue(monthNode.aggregates!.costeTotalOmie),
          numberValue(monthNode.aggregates!.facturaCompra),
          numberValue(monthNode.aggregates!.facturaVenta)
        )
      }
    } satisfies LiquidationMonthGroup;
  });
}

function buildTotals(rowsToAggregate: LiquidationRow[]) {
  const costeTotalOmie = sumDefined(rowsToAggregate.map((row) => row.costeTotalOmie));
  const facturaCompra = sumDefined(rowsToAggregate.map((row) => row.facturaCompra));
  const facturaVenta = sumDefined(rowsToAggregate.map((row) => row.facturaVenta));
  return {
    costeTotalOmie,
    facturaCompra,
    facturaVenta,
    descuadre: calculateMismatch(costeTotalOmie, facturaCompra, facturaVenta)
  };
}

function buildMonthTotals(days: LiquidationDayGroup[]) {
  return {
    rowCount: days.length,
    costeTotalOmie: sumDefined(days.map((day) => day.totals.costeTotalOmie)),
    facturaCompra: sumDefined(days.map((day) => day.totals.facturaCompra)),
    facturaVenta: sumDefined(days.map((day) => day.totals.facturaVenta)),
    descuadre: calculateMismatch(
      sumDefined(days.map((day) => day.totals.costeTotalOmie)),
      sumDefined(days.map((day) => day.totals.facturaCompra)),
      sumDefined(days.map((day) => day.totals.facturaVenta))
    )
  };
}

function flattenVisibleEntries(groups: LiquidationMonthGroup[], expandedDays: Set<string>) {
  return groups.flatMap((month) => [
    `month:${month.key}`,
    ...month.days.flatMap((day) => [`day:${day.key}`, ...(expandedDays.has(day.key) ? day.rows.map((row) => row.id) : [])])
  ]);
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

test("Comprobacion Liquidaciones monthly hierarchy matches legacy grouping and subtotals", () => {
  const legacy = buildLegacyHierarchy(rows, "asc");
  const v2 = buildV2Hierarchy(rows, "asc");

  assert.equal(v2.length, legacy.length);
  assert.deepEqual(v2.map((month) => month.key), legacy.map((month) => month.key));
  assert.deepEqual(v2.map((month) => month.days.length), legacy.map((month) => month.days.length));
  assert.deepEqual(v2.map((month) => month.totals.rowCount), legacy.map((month) => month.days.length));
  assert.deepEqual(v2.map((month) => month.totals.costeTotalOmie), legacy.map((month) => month.totals.costeTotalOmie));
  assert.deepEqual(v2.map((month) => month.totals.facturaCompra), legacy.map((month) => month.totals.facturaCompra));
  assert.deepEqual(v2.map((month) => month.totals.facturaVenta), legacy.map((month) => month.totals.facturaVenta));
  assert.deepEqual(v2.flatMap((month) => month.days.map((day) => day.key)), legacy.flatMap((month) => month.days.map((day) => day.key)));
  assert.deepEqual(v2.flatMap((month) => month.days.map((day) => day.totals.costeTotalOmie)), legacy.flatMap((month) => month.days.map((day) => day.totals.costeTotalOmie)));
  assert.deepEqual(v2.flatMap((month) => month.days.map((day) => day.totals.facturaCompra)), legacy.flatMap((month) => month.days.map((day) => day.totals.facturaCompra)));
  assert.deepEqual(v2.flatMap((month) => month.days.map((day) => day.totals.facturaVenta)), legacy.flatMap((month) => month.days.map((day) => day.totals.facturaVenta)));
});

test("Comprobacion Liquidaciones expansion order stays stable in asc and desc", () => {
  const expandedDays = new Set(["2026-06-01", "2026-07-02"]);
  const legacyAsc = buildLegacyHierarchy(rows, "asc");
  const v2Asc = buildV2Hierarchy(rows, "asc");
  const legacyDesc = buildLegacyHierarchy(rows, "desc");
  const v2Desc = buildV2Hierarchy(rows, "desc");

  assert.deepEqual(flattenVisibleEntries(v2Asc, expandedDays), flattenVisibleEntries(legacyAsc, expandedDays));
  assert.deepEqual(flattenVisibleEntries(v2Desc, expandedDays), flattenVisibleEntries(legacyDesc, expandedDays));
  assert.deepEqual(v2Desc.map((month) => month.key), ["2026-07", "2026-06"]);
  assert.deepEqual(v2Desc[0].days.map((day) => day.key), ["2026-07-02", "2026-07-01"]);
});
