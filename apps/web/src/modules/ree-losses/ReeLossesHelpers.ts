import type { ReactNode } from "react";
import type { EChartsOption } from "echarts";
import type { ReeLossesAnnualSummaryRow, ReeLossesAnalyticsSummary, ReeLossesImportFile, ReeLossesImportResponse, ReeLossesReport, ReeLossesRow } from "../../api";
import type { LoadStatus } from "../../app-shell/AppShellTypes";
import type { RowQuality, TechnicalKpi } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
import { withGlobalLoading } from "../../loading";
import type { ReeLossesLoadSortKey } from "./ReeLossesTypes";

export const REE_LOSSES_VERSION_PALETTE = ["#64748b", "#2563eb", "#16a34a", "#7c3aed", "#f97316", "#0f766e"];

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return `${match[2]}/${match[1]}`;
}

export function formatRatioPercent(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric * 100, 2)}%`;
}

export function ratioPercentValue(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? undefined : numeric * 100;
}

export function formatEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

export function formatSignedEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  if (numeric === undefined) {
    return "-";
  }
  return `${numeric > 0 ? "+" : ""}${formatFixedDecimalNumber(numeric, 2)}`;
}

export function formatEuroAmount(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €`;
}

export function formatPrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €/MWh`;
}

export function formatDecimalNumber(value: number, decimals = 3) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function formatFixedDecimalNumber(value: number, decimals = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function formatDate(value?: string | null) {
  const parsed = parseDateText(value);
  return parsed ? new Intl.DateTimeFormat("es-ES").format(parsed.date) : "-";
}

export function formatFullDate(value?: string | null) {
  const parsed = parseDateText(value);
  if (!parsed) {
    return "-";
  }

  return `${pad2(parsed.date.getUTCDate())}/${pad2(parsed.date.getUTCMonth() + 1)}/${parsed.date.getUTCFullYear()}`;
}

export function formatDateTime(value?: string | null) {
  const date = parseDateTimeValue(value);
  return date
    ? new Intl.DateTimeFormat("es-ES", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC"
      }).format(date)
    : "-";
}

export function parseDateTimeValue(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const nativeDate = new Date(trimmed);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  const parsed = parseDateText(trimmed);
  if (!parsed) {
    return undefined;
  }

  const date = new Date(parsed.date);
  if (parsed.hour !== undefined && parsed.minute !== undefined) {
    date.setUTCHours(parsed.hour, parsed.minute, 0, 0);
  }
  return date;
}

export function parseDateText(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(trimmed);
  if (compact) {
    return buildDateParts(
      Number(compact[1]),
      Number(compact[2]),
      Number(compact[3]),
      compact[4] === undefined ? undefined : Number(compact[4]),
      compact[5] === undefined ? undefined : Number(compact[5])
    );
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z)?)?$/.exec(trimmed);
  if (iso) {
    return buildDateParts(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] === undefined ? undefined : Number(iso[4]),
      iso[5] === undefined ? undefined : Number(iso[5])
    );
  }

  const european = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(trimmed);
  if (european) {
    return buildDateParts(
      Number(european[3]),
      Number(european[2]),
      Number(european[1]),
      european[4] === undefined ? undefined : Number(european[4]),
      european[5] === undefined ? undefined : Number(european[5])
    );
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : { date };
}

function buildDateParts(year: number, month: number, day: number, hour?: number, minute?: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  if (hour === undefined && minute === undefined) {
    return { date };
  }

  if (hour === undefined || minute === undefined || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  return { date, hour, minute };
}

export function formatNumber(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  if (numeric === undefined) {
    return "-";
  }

  const sign = numeric < 0 ? "-" : "";
  const absolute = Math.abs(numeric);
  const fixed = absolute.toFixed(3);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmedDecimals = decimalPart.replace(/0+$/, "");
  return trimmedDecimals ? `${sign}${groupedInteger},${trimmedDecimals}` : `${sign}${groupedInteger}`;
}

export function formatPercentOf(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format((part / total) * 100) + "%";
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value || 0);
}

export function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    const parsed =
      lastComma > lastDot
        ? Number(normalized.replace(/\./g, "").replace(",", "."))
        : Number(normalized.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (hasComma) {
    const parsed = Number(normalized.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function qualityLabel(part: number, total: number) {
  return total > 0 ? `${formatFixedDecimalNumber((part / total) * 100, 2)}% del total` : "Sin registros";
}

export function toMonthKeyFromIso(value?: string | null) {
  return value?.slice(0, 7) ?? "";
}

function exportCsv<T extends object>(name: string, rows: T[]) {
  void withGlobalLoading(
    () => {
      if (rows.length === 0) {
        return;
      }
      const headers = Object.keys(flattenRow(rows[0]));
      const lines = [
        headers.join(";"),
        ...rows.map((row) => headers.map((header) => csvCell(flattenRow(row)[header])).join(";"))
      ];
      downloadBlob(name, lines.join("\n"), "text/csv;charset=utf-8");
    },
    { label: "Preparando exportación" }
  );
}

function flattenRow(row: object) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, value]) => typeof value !== "object" || value === null)
      .map(([key, value]) => [key, value])
  );
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

export function buildReeLossesHistoryKpis(files: ReeLossesImportFile[], latestImport?: ReeLossesImportResponse) {
  const totals = files.reduce(
    (acc, file) => ({
      records: acc.records + file.totalRecords,
      valid: acc.valid + file.validRecords,
      invalid: acc.invalid + file.invalidRecords,
      duplicated: acc.duplicated + file.duplicatedRecords
    }),
    { records: 0, valid: 0, invalid: 0, duplicated: 0 }
  );
  const latestFile = [...files].sort((left, right) => new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime())[0];
  const sortedPeriods = [...files].map(getReeLossesImportPeriodKey).filter(Boolean).sort();
  const latestPeriod = sortedPeriods[sortedPeriods.length - 1];

  return [
    { label: "Total registros", value: totals.records.toLocaleString("es-ES"), detail: `${files.length} cargas`, tone: "info" },
    { label: "Válidos", value: totals.valid.toLocaleString("es-ES"), detail: qualityLabel(totals.valid, totals.records), tone: "good" },
    { label: "Inválidos", value: totals.invalid.toLocaleString("es-ES"), detail: qualityLabel(totals.invalid, totals.records), tone: totals.invalid > 0 ? "danger" : "good" },
    { label: "Duplicados", value: totals.duplicated.toLocaleString("es-ES"), detail: qualityLabel(totals.duplicated, totals.records), tone: totals.duplicated > 0 ? "warning" : "good" },
    { label: "Última carga", value: latestFile ? formatDateTime(latestFile.importedAt) : "-", detail: latestImport ? `${latestImport.summary.recordsImported} registros importados` : "Sin carga en sesión", tone: "accent" },
    { label: "Último periodo", value: latestPeriod ? formatMonthKeyLabel(latestPeriod) : "-", detail: latestFile?.version ?? "Sin periodo", tone: "info" }
  ];
}

export function buildReeLossesHistoryCharts(files: ReeLossesImportFile[]) {
  const monthlyLoads = aggregateReeLossesImportFiles(files, getReeLossesImportPeriodKey, () => 1).slice(-8);
  const monthlyInvalids = aggregateReeLossesImportFiles(files, getReeLossesImportPeriodKey, (file) => file.invalidRecords).slice(-8);
  const byType = aggregateReeLossesImportFiles(files, (file) => file.tipoArchivo ?? "Sin tipo", (file) => file.totalRecords);

  return { monthlyLoads, monthlyInvalids, byType };
}

export function buildReeLossesRowsScopeLabel(rows: ReeLossesRow[]) {
  return `Periodo: ${formatReeLossesDateRange(rows.map((row) => row.fecha))} · Versiones: ${formatReeLossesVersionList(rows.map((row) => row.version))}`;
}

export function buildReeLossesHeatmapScopeLabel(summary: ReeLossesAnalyticsSummary) {
  const period =
    summary.heatmapRows.length > 0
      ? formatReeLossesDateRange(summary.heatmapRows.map((row) => row.fecha))
      : formatReeLossesMonthRange(summary.latestMonth ? [summary.latestMonth] : []);
  return `Periodo: ${period} · Version: ${summary.latestVersion ?? "-"}`;
}

export function buildReeLossesAnalyticsScopeLabel(summary: ReeLossesAnalyticsSummary) {
  const versions = summary.versionComparison.map((row) => row.label).filter((label) => label !== "BOE");
  return `Periodo: ${formatReeLossesMonthRange(summary.months)} · Versiones: ${formatReeLossesVersionList(versions)}`;
}

export function buildReeLossesLatestAnnualScopeLabel(rows: ReeLossesAnnualSummaryRow[], fallbackMonths: string[]) {
  const months = rows.length > 0 ? rows.map((row) => row.mes) : fallbackMonths;
  return `Periodo: ${formatReeLossesMonthRange(months)} · Versiones: ${formatReeLossesVersionList(rows.map((row) => row.version))} (ultima disponible por mes)`;
}

function formatReeLossesDateRange(dates: string[]) {
  const sorted = [...new Set(dates.filter(Boolean))].sort();
  if (sorted.length === 0) {
    return "-";
  }
  const first = formatFullDate(sorted[0]);
  const last = formatFullDate(sorted[sorted.length - 1]);
  return first === last ? first : `${first} - ${last}`;
}

function formatReeLossesMonthRange(months: string[]) {
  const sorted = [...new Set(months.filter(Boolean))].sort();
  if (sorted.length === 0) {
    return "-";
  }
  const first = formatMonthKeyLabel(sorted[0]);
  const last = formatMonthKeyLabel(sorted[sorted.length - 1]);
  return first === last ? first : `${first} - ${last}`;
}

function formatReeLossesVersionList(versions: Array<string | null | undefined>) {
  const sorted = [...new Set(versions.filter((version): version is string => Boolean(version)))]
    .sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
  return sorted.length > 0 ? sorted.join(", ") : "-";
}

function aggregateReeLossesImportFiles(
  files: ReeLossesImportFile[],
  getKey: (file: ReeLossesImportFile) => string,
  getValue: (file: ReeLossesImportFile) => number
) {
  const map = new Map<string, number>();
  for (const file of files) {
    const key = getKey(file) || "Sin periodo";
    map.set(key, (map.get(key) ?? 0) + getValue(file));
  }
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({ label, value }));
}

export function compareReeLossesLoads(left: ReeLossesImportFile, right: ReeLossesImportFile, sortKey: ReeLossesLoadSortKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftValue = getReeLossesLoadSortValue(left, sortKey);
  const rightValue = getReeLossesLoadSortValue(right, sortKey);
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }
  return String(leftValue).localeCompare(String(rightValue), "es") * multiplier;
}

function getReeLossesLoadSortValue(file: ReeLossesImportFile, sortKey: ReeLossesLoadSortKey) {
  switch (sortKey) {
    case "status":
      return getReeLossesLoadStatus(file);
    case "type":
      return file.tipoArchivo ?? "";
    case "period":
      return file.fechaInicio ?? "";
    case "fileName":
      return file.fileName;
    case "totalRecords":
      return file.totalRecords;
    case "validRecords":
      return file.validRecords;
    case "invalidRecords":
      return file.invalidRecords;
    case "duplicatedRecords":
      return file.duplicatedRecords;
    case "importedAt":
      return new Date(file.importedAt).getTime();
  }
}

export function getReeLossesLoadStatus(file: ReeLossesImportFile): LoadStatus {
  if (file.status === "FAILED") {
    return "error";
  }
  if (file.status === "DUPLICATED" || file.invalidRecords > 0 || file.duplicatedRecords > 0) {
    return "partial";
  }
  return "valid";
}

export function getReeLossesImportPeriodKey(file: ReeLossesImportFile) {
  return toMonthKeyFromIso(file.fechaInicio ?? file.fechaFin ?? file.importedAt);
}

export function getReeLossesImportPeriodLabel(file: ReeLossesImportFile) {
  if (file.fechaInicio && file.fechaFin) {
    return `${formatDate(file.fechaInicio)} - ${formatDate(file.fechaFin)}`;
  }
  return file.fechaInicio || file.fechaFin ? formatDate(file.fechaInicio ?? file.fechaFin) : "-";
}

export function exportReeLossesLoadCsv(name: string, files: ReeLossesImportFile[]) {
  exportCsv(
    name,
    files.map((file) => ({
      estado: getReeLossesLoadStatus(file),
      version: file.version ?? "",
      tipoFichero: file.tipoArchivo ?? "",
      periodo: getReeLossesImportPeriodLabel(file),
      archivo: file.fileName,
      registros: file.totalRecords,
      validos: file.validRecords,
      invalidos: file.invalidRecords,
      duplicados: file.duplicatedRecords,
      fechaCarga: formatDateTime(file.importedAt),
      observaciones: file.errorMessage ?? ""
    }))
  );
}

export function buildReeLossesKpis(report: ReeLossesReport): TechnicalKpi[] {
  const kpis = report.kpis;
  return [
    { label: "Perdida media", value: formatLossPercent(kpis.perdidaMedia), tone: lossTone(kpis.desviacionMediaVsBoe) },
    { label: "Perdida maxima", value: formatLossPercent(kpis.perdidaMaxima) },
    { label: "Perdida minima", value: formatLossPercent(kpis.perdidaMinima) },
    { label: "Desv. media vs BOE", value: formatSignedLossPercent(kpis.desviacionMediaVsBoe), tone: lossTone(kpis.desviacionMediaVsBoe) },
    { label: "Dias anomalos", value: formatNumber(kpis.diasAnomalos), tone: kpis.diasAnomalos > 0 ? "warning" : "good" },
    { label: "Registros incompletos", value: formatNumber(kpis.registrosIncompletos), tone: kpis.registrosIncompletos > 0 ? "warning" : "good" },
    { label: "Huecos detectados", value: formatNumber(kpis.huecosDetectados), tone: kpis.huecosDetectados > 0 ? "danger" : "good" },
    { label: "Archivos procesados", value: formatNumber(kpis.archivosProcesados) },
    { label: "Version activa", value: kpis.versionActivaUtilizada ?? "-" }
  ];
}

export function buildReeLossesEvolutionOption(rows: ReeLossesRow[]): EChartsOption {
  const points = aggregateReeLossesByTime(rows);
  return {
    color: ["#0f766e", "#dc2626", "#f59e0b"],
    tooltip: { trigger: "axis", valueFormatter: (value) => (typeof value === "number" ? `${formatDecimalNumber(value, 2)}%` : String(value ?? "-")) },
    legend: { top: 2, textStyle: { color: "#294553", fontWeight: 700 } },
    grid: { left: 52, right: 28, top: 54, bottom: 70, containLabel: true },
    dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", height: 22, bottom: 20, filterMode: "none" }],
    xAxis: { type: "category", data: points.map((point) => point.label), axisLabel: { color: "#5a7381", hideOverlap: true } },
    yAxis: { type: "value", name: "%", axisLabel: { color: "#5a7381", formatter: (value: number) => `${formatDecimalNumber(value, 0)}%` }, splitLine: { lineStyle: { color: "#edf2f5" } } },
    series: [
      { name: "Perdida BOE", type: "line", smooth: true, symbolSize: 4, data: points.map((point) => point.boe) },
      { name: "Perdida REE", type: "line", smooth: true, symbolSize: 4, data: points.map((point) => point.final) },
      { name: "Desviacion", type: "bar", barMaxWidth: 10, data: points.map((point) => point.diff) }
    ]
  };
}

export function buildReeLossesHeatmapOption(rows: ReeLossesRow[]): EChartsOption {
  const days = [...new Set(rows.map((row) => row.fecha))].sort();
  const data = buildReeLossesHeatmapData(rows, days);
  const max = Math.max(...data.map((item) => Number(item[2] ?? 0)), 1);
  return {
    tooltip: {
      position: "top",
      formatter: (params: any) => {
        const value = params.value as [number, number, number];
        return `${formatFullDate(days[value[1]])}<br/>Hora ${value[0] + 1}: ${formatLossPercent(value[2])}`;
      }
    },
    grid: { left: 64, right: 24, top: 20, bottom: 46 },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, index) => String(index + 1)), splitArea: { show: true }, axisLabel: { color: "#5a7381" } },
    yAxis: { type: "category", data: days.map(formatShortDate), splitArea: { show: true }, axisLabel: { color: "#5a7381" } },
    visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#dcfce7", "#fef3c7", "#fee2e2"] } },
    series: [{ name: "% perdida", type: "heatmap", data, emphasis: { itemStyle: { borderColor: "#17313f", borderWidth: 1 } } }]
  };
}

export function buildReeLossesSummaryHeatmapOption(summary: ReeLossesAnalyticsSummary): EChartsOption {
  const days = [...new Set(summary.heatmapRows.map((row) => row.fecha))].sort();
  const data = summary.heatmapRows.map((row) => [row.hora - 1, days.indexOf(row.fecha), row.perdidaFinal ?? 0]);
  const max = Math.max(...data.map((item) => Number(item[2] ?? 0)), 1);
  return {
    tooltip: {
      position: "top",
      formatter: (params: any) => {
        const value = params.value as [number, number, number];
        return `${formatFullDate(days[value[1]])}<br/>Hora ${value[0] + 1}: ${formatLossPercent(value[2])}<br/>${summary.latestVersion ?? "-"} ${summary.latestMonth ?? ""}`;
      }
    },
    grid: { left: 64, right: 24, top: 20, bottom: 46 },
    xAxis: { type: "category", data: Array.from({ length: 24 }, (_, index) => String(index + 1)), splitArea: { show: true }, axisLabel: { color: "#5a7381" } },
    yAxis: { type: "category", data: days.map(formatShortDate), splitArea: { show: true }, axisLabel: { color: "#5a7381" } },
    visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#dcfce7", "#fef3c7", "#fee2e2"] } },
    series: [{ name: "% perdida", type: "heatmap", data, emphasis: { itemStyle: { borderColor: "#17313f", borderWidth: 1 } } }]
  };
}

export function buildReeLossesVersionSourceCompareOption(rows: ReeLossesAnalyticsSummary["versionComparison"]): EChartsOption {
  const values = rows.map((row) => ({ label: row.label, value: row.value }));
  return buildSimpleBarOption(values, "% perdida", ["#0f766e", ...REE_LOSSES_VERSION_PALETTE]);
}

export function buildReeLossesSourceCompareOption(rows: ReeLossesRow[]): EChartsOption {
  const values = [
    { label: "BOE", value: averageNumbers(rows.map((row) => row.perdidaBoe)) },
    { label: "KESTIM", value: averageNumbers(rows.filter((row) => row.kestimValorK !== null).map((row) => row.perdidaBoe === null || row.kestimValorK === null ? null : row.perdidaBoe * row.kestimValorK)) },
    { label: "KREAL", value: averageNumbers(rows.filter((row) => row.krealValorK !== null).map((row) => row.perdidaBoe === null || row.krealValorK === null ? null : row.perdidaBoe * row.krealValorK)) }
  ];
  return buildSimpleBarOption(values, "% perdida", ["#0f766e", "#f59e0b", "#dc2626"]);
}

export function buildReeLossesVersionCompareOption(rows: ReeLossesRow[]): EChartsOption {
  const days = [...new Set(rows.map((row) => row.fecha))].sort();
  const versions = [...new Set(rows.map((row) => row.version))].sort();
  return {
    color: REE_LOSSES_VERSION_PALETTE,
    tooltip: { trigger: "axis", valueFormatter: (value) => (typeof value === "number" ? `${formatDecimalNumber(value, 2)}%` : String(value ?? "-")) },
    legend: { top: 2, textStyle: { color: "#294553", fontWeight: 700 } },
    grid: { left: 52, right: 20, top: 52, bottom: 56, containLabel: true },
    xAxis: { type: "category", data: days.map(formatShortDate), axisLabel: { color: "#5a7381", hideOverlap: true } },
    yAxis: { type: "value", name: "%", axisLabel: { color: "#5a7381", formatter: (value: number) => `${formatDecimalNumber(value, 0)}%` }, splitLine: { lineStyle: { color: "#edf2f5" } } },
    series: versions.map((version) => ({
      name: version,
      type: "line",
      smooth: true,
      symbolSize: 5,
      data: days.map((day) => averageNumbers(rows.filter((row) => row.fecha === day && row.version === version).map((row) => row.perdidaFinal)))
    }))
  };
}

export function buildReeLossesPeriodDistributionFromAnnualOption(rows: ReeLossesAnnualSummaryRow[]): EChartsOption {
  const periods = ["P1", "P2", "P3", "P4", "P5", "P6"];
  const tarifas = [...new Set(rows.map((row) => row.tarifa))].sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
  return {
    color: REE_LOSSES_VERSION_PALETTE,
    tooltip: { trigger: "axis", valueFormatter: (value) => (typeof value === "number" ? `${formatDecimalNumber(value, 2)}%` : String(value ?? "-")) },
    legend: { type: "scroll", top: 2, left: 10, right: 10, textStyle: { color: "#294553", fontWeight: 700 } },
    grid: { left: 56, right: 28, top: 96, bottom: 56, containLabel: true },
    xAxis: { type: "category", data: tarifas, axisLabel: { color: "#5a7381", fontWeight: 800 } },
    yAxis: { type: "value", name: "% perdida", axisLabel: { color: "#5a7381", formatter: (value: number) => `${formatDecimalNumber(value, 0)}%` }, splitLine: { lineStyle: { color: "#edf2f5" } } },
    series: periods.map((periodo) => ({
      name: periodo,
      type: "bar",
      barGap: "8%",
      barCategoryGap: "18%",
      barMaxWidth: 42,
      label: {
        show: true,
        position: "top",
        color: "#294553",
        fontSize: 11,
        fontWeight: 800,
        formatter: (params: { value?: unknown }) => (typeof params.value === "number" ? `${formatDecimalNumber(params.value, 2)}%` : "")
      },
      labelLayout: { hideOverlap: true },
      emphasis: { focus: "series" },
      data: tarifas.map((tarifa) => weightedAverageAnnualLoss(rows.filter((row) => row.tarifa === tarifa && row.periodo === periodo)))
    }))
  };
}

export function buildReeLossesPeriodDistributionOption(rows: ReeLossesRow[]): EChartsOption {
  const values = ["P1", "P2", "P3", "P4", "P5", "P6"].map((periodo) => ({
    label: periodo,
    value: averageNumbers(rows.filter((row) => row.periodo === periodo).map((row) => row.perdidaFinal))
  }));
  return buildSimpleBarOption(values, "% perdida", ["#0f766e", "#2563eb", "#7c3aed", "#f59e0b", "#dc2626", "#64748b"]);
}

export function buildReeLossesAnnualColumns(rows: ReeLossesAnnualSummaryRow[]) {
  const columns = new Map<string, { key: string; label: string; tarifa: string; periodo: string }>();
  for (const row of rows) {
    const key = buildReeLossesAnnualColumnKey(row.tarifa, row.periodo);
    columns.set(key, { key, label: `${row.tarifa} - ${row.periodo}`, tarifa: row.tarifa, periodo: row.periodo });
  }
  return [...columns.values()].sort((left, right) =>
    left.tarifa.localeCompare(right.tarifa, "es", { numeric: true }) ||
    left.periodo.localeCompare(right.periodo, "es", { numeric: true })
  );
}

export function pivotReeLossesAnnualRows(rows: ReeLossesAnnualSummaryRow[]) {
  const groups = new Map<
    string,
    { mes: string; versions: Set<string>; records: number; values: Record<string, ReeLossesAnnualSummaryRow> }
  >();
  for (const row of rows) {
    const current = groups.get(row.mes) ?? { mes: row.mes, versions: new Set<string>(), records: 0, values: {} };
    current.versions.add(row.version);
    current.values[buildReeLossesAnnualColumnKey(row.tarifa, row.periodo)] = row;
    current.records += row.records;
    groups.set(row.mes, current);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      versionLabel: [...row.versions].sort((left, right) => left.localeCompare(right, "es", { numeric: true })).join(", ")
    }))
    .sort((left, right) => left.mes.localeCompare(right.mes));
}

export function buildReeLossesAnnualColumnKey(tarifa: string, periodo: string) {
  return `${tarifa}|${periodo}`;
}

export function weightedAverageAnnualLoss(rows: ReeLossesAnnualSummaryRow[]) {
  const present = rows.filter((row) => row.perdidaFinal !== null && row.records > 0);
  const totalRecords = present.reduce((sum, row) => sum + row.records, 0);
  return totalRecords === 0 ? null : present.reduce((sum, row) => sum + (row.perdidaFinal ?? 0) * row.records, 0) / totalRecords;
}

export function buildSimpleBarOption(values: Array<{ label: string; value: number | null }>, axisName: string, colors: string[]): EChartsOption {
  return {
    color: colors,
    tooltip: { trigger: "axis", valueFormatter: (value) => (typeof value === "number" ? `${formatDecimalNumber(value, 2)}%` : String(value ?? "-")) },
    grid: { left: 52, right: 18, top: 24, bottom: 42, containLabel: true },
    xAxis: { type: "category", data: values.map((item) => item.label), axisLabel: { color: "#5a7381" } },
    yAxis: { type: "value", name: axisName, axisLabel: { color: "#5a7381", formatter: (value: number) => `${formatDecimalNumber(value, 0)}%` }, splitLine: { lineStyle: { color: "#edf2f5" } } },
    series: [{ type: "bar", barMaxWidth: 34, data: values.map((item, index) => ({ value: item.value, itemStyle: { color: colors[index % colors.length] } })) }]
  };
}

export function buildReeLossesTotalsRow(rows: ReeLossesRow[]): Record<string, ReactNode> {
  return {
    fecha: "MEDIA",
    hora: "",
    cuartohora: "",
    tarifa: "",
    periodo: "",
    perdidaBoe: formatLossPercent(averageNumbers(rows.map((row) => row.perdidaBoe))),
    factorK: formatFactor(averageNumbers(rows.map((row) => row.factorKAplicado))),
    perdidaFinal: formatLossPercent(averageNumbers(rows.map((row) => row.perdidaFinal))),
    diferenciaVsBoe: formatLossPercent(averageNumbers(rows.map((row) => row.diferenciaVsBoe))),
    diferenciaPct: formatSignedLossPercent(averageNumbers(rows.map((row) => row.diferenciaPct))),
    tipo: "",
    version: "",
    versionBoe: "",
    anomalias: `${rows.filter((row) => row.anomalies.length > 0).length} anomalias`
  };
}

export function reeLossesQuality(row: ReeLossesRow): RowQuality {
  const dangerLabels = ["perdida_negativa", "perdida_extrema", "periodo_invalido", "cuartohora_inexistente_cambio_horario"];
  const tone = row.anomalies.some((item) => dangerLabels.includes(item)) ? "danger" : row.anomalies.length > 0 ? "warning" : "ok";
  return {
    tone,
    labels: row.anomalies.map(formatAnomalyLabel)
  };
}

export function aggregateReeLossesByTime(rows: ReeLossesRow[]) {
  const groups = new Map<string, { label: string; boe: Array<number | null>; final: Array<number | null>; diff: Array<number | null> }>();
  for (const row of rows) {
    const key = [row.fecha, row.hora, row.cuartohora].join("|");
    const current = groups.get(key) ?? { label: `${formatShortDate(row.fecha)} H${row.hora}.${row.cuartohora}`, boe: [], final: [], diff: [] };
    current.boe.push(row.perdidaBoe);
    current.final.push(row.perdidaFinal);
    current.diff.push(row.diferenciaVsBoe);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "es", { numeric: true }))
    .map(([, group]) => ({
      label: group.label,
      boe: averageNumbers(group.boe),
      final: averageNumbers(group.final),
      diff: averageNumbers(group.diff)
    }));
}

export function buildReeLossesHeatmapData(rows: ReeLossesRow[], days: string[]) {
  const groups = new Map<string, Array<number | null>>();
  for (const row of rows) {
    const key = [row.fecha, row.hora].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row.perdidaFinal]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [day, hour] = key.split("|");
    return [Number(hour) - 1, days.indexOf(day), averageNumbers(values) ?? 0];
  });
}

export function averageNumbers(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function lossTone(value: number | null | undefined): TechnicalKpi["tone"] {
  if (value === null || value === undefined) {
    return "neutral";
  }
  if (value < -0.01) {
    return "good";
  }
  if (value > 5) {
    return "danger";
  }
  if (value > 1) {
    return "warning";
  }
  return "neutral";
}

export function formatLossPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${formatNumber(value)}%`;
}

export function formatSignedLossPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}%`;
}

export function formatFactor(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : formatFixedDecimalNumber(value, 6);
}

export function formatShortDate(value: string) {
  const parsed = parseDateText(value);
  return parsed ? `${pad2(parsed.date.getUTCDate())}/${pad2(parsed.date.getUTCMonth() + 1)}` : value;
}

export function formatAnomalyLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace("perdida", "perd.")
    .replace("cuartohora", "qh");
}

export function anomalyBadgeTone(value: string) {
  if (value.includes("negativa") || value.includes("extrema") || value.includes("invalido") || value.includes("inexistente")) {
    return "danger";
  }
  if (value.includes("moderada")) {
    return "warning";
  }
  return "warning";
}
