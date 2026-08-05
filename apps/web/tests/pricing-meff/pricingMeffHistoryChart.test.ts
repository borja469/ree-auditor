import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistorySeriesRows,
  buildPricingMeffHistoryChartOption,
  formatChartDate,
  formatChartPrice,
  getHistoryStats,
  getReferenceLabelPosition
} from "../../src/modules/pricing/pricingMeffHistoryChart.js";

const rows = [
  { fechaPublicacion: "2026-07-21", precio: 51.7 },
  { fechaPublicacion: "2026-07-22", precio: 62.3 },
  { fechaPublicacion: "2026-07-23", precio: 70.4 }
];

test("formats MEFF chart prices with Spanish decimals and unit", () => {
  assert.equal(formatChartPrice(70.4, 1), "70,4 €/MWh");
  assert.equal(formatChartPrice(8760, 2), "8.760,00 €/MWh");
});

test("formats MEFF chart dates using abbreviated Spanish labels", () => {
  assert.equal(formatChartDate("2026-07-23"), "23 jul 26");
  assert.equal(formatChartDate("2026-07-23", true), "23 jul");
});

test("keeps max and min labels inside the chart area", () => {
  assert.equal(getReferenceLabelPosition("max"), "insideEndTop");
  assert.equal(getReferenceLabelPosition("min"), "insideEndBottom");
});

test("calculates a dynamic Y domain around historical prices", () => {
  const stats = getHistoryStats(buildHistorySeriesRows(rows));
  assert.equal(stats?.minPrice, 51.7);
  assert.equal(stats?.maxPrice, 70.4);
  assert.equal(stats?.yMin, 50);
  assert.equal(stats?.yMax, 72);
});

test("builds clear max and min reference labels", () => {
  const option = buildPricingMeffHistoryChartOption(rows, { fechaPublicacion: "2026-07-23", precio: 70.4 }, "ALL");
  const series = option.series as Array<{ markLine?: { data?: Array<{ label: { formatter: string } }> } }> | undefined;
  const referenceLines = series?.[0]?.markLine?.data;

  assert.ok(Array.isArray(referenceLines));
  assert.equal(referenceLines[0].label.formatter, "Máx. 70,4 €/MWh");
  assert.equal(referenceLines[1].label.formatter, "Mín. 51,7 €/MWh");
});
