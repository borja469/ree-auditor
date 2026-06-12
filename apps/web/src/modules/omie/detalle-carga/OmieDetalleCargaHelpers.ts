import type { ReactNode } from "react";
import { buildHierarchyWithAggregates, type TechnicalAggregateColumnDefinition, type TechnicalHierarchyLevel } from "../../../technical-module-v2";
import { withGlobalLoading } from "../../../loading";
import type { OmieAnalisisMensualPeriodo, OmieAnalisisMensualResponse } from "../../../api";
import type {
  OmieAnalisisDailyRow,
  OmieDetalleCargaKpi,
  OmieDetalleCargaTechnicalColumn,
  OmieMonthlyAnalysisDailyCellValue,
  OmieMonthlyAnalysisTableRow
} from "./OmieDetalleCargaTypes";

const OMIE_MONTHLY_ANALYSIS_DAY_LEVELS: Array<TechnicalHierarchyLevel<OmieAnalisisMensualPeriodo>> = [
  {
    id: "fecha",
    getKey: (row) => row.fecha,
    getLabel: (row) => row.fecha
  }
];

const OMIE_MONTHLY_ANALYSIS_DAY_AGGREGATES: Array<TechnicalAggregateColumnDefinition<OmieAnalisisMensualPeriodo>> = [
  { id: "periodos", aggregate: "count" },
  { id: "programaMd", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.programaMd)) } },
  { id: "volIda1", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.volIda1)) } },
  { id: "volIda2", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.volIda2)) } },
  { id: "volIda3", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.volIda3)) } },
  { id: "volXbid", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.volXbid)) } },
  { id: "energiaTotal", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map(omieMonthlyPeriodEnergyTotal)) } },
  { id: "profitIda1", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.profitIda1)) } },
  { id: "profitIda2", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.profitIda2)) } },
  { id: "profitIda3", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.profitIda3)) } },
  { id: "profitXbid", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.profitXbid)) } },
  { id: "profitTotal", aggregate: { kind: "custom", calculate: (currentRows) => nullableNumericSum(currentRows.map((row) => row.sumaProfit)) } },
  {
    id: "profitMedioEurMWh",
    aggregate: {
      kind: "custom",
      calculate: (currentRows) =>
        omieProfitRate(
          nullableNumericSum(currentRows.map((row) => row.sumaProfit)),
          nullableNumericSum(currentRows.map(omieMonthlyPeriodEnergyTotal))
        )
    }
  }
];

export function buildOmieMonthlyAnalysisDailyRows(rows: OmieAnalisisMensualPeriodo[]): OmieAnalisisDailyRow[] {
  const groups = new Map<string, OmieAnalisisMensualPeriodo[]>();
  for (const row of rows) {
    const current = groups.get(row.fecha) ?? [];
    current.push(row);
    groups.set(row.fecha, current);
  }

  return [...groups.entries()]
    .map(([fecha, dayRows]) => {
      const sortedRows = [...dayRows].sort((left, right) => left.periodo - right.periodo || left.clave.localeCompare(right.clave, "es"));
      const programaMd = nullableNumericSum(sortedRows.map((row) => row.programaMd));
      const volIda1 = nullableNumericSum(sortedRows.map((row) => row.volIda1));
      const volIda2 = nullableNumericSum(sortedRows.map((row) => row.volIda2));
      const volIda3 = nullableNumericSum(sortedRows.map((row) => row.volIda3));
      const volXbid = nullableNumericSum(sortedRows.map((row) => row.volXbid));
      const energiaTotal = nullableNumericSum(sortedRows.map(omieMonthlyPeriodEnergyTotal));
      const profitIda1 = nullableNumericSum(sortedRows.map((row) => row.profitIda1));
      const profitIda2 = nullableNumericSum(sortedRows.map((row) => row.profitIda2));
      const profitIda3 = nullableNumericSum(sortedRows.map((row) => row.profitIda3));
      const profitXbid = nullableNumericSum(sortedRows.map((row) => row.profitXbid));
      const profitTotal = nullableNumericSum(sortedRows.map((row) => row.sumaProfit));

      return {
        fecha,
        diaSemana: formatWeekdayName(fecha),
        periodos: sortedRows.length,
        programaMd,
        volIda1,
        volIda2,
        volIda3,
        volXbid,
        energiaTotal,
        profitIda1,
        profitIda2,
        profitIda3,
        profitXbid,
        profitTotal,
        profitMedioEurMWh: omieProfitRate(profitTotal, energiaTotal),
        rows: sortedRows
      };
    })
    .sort((left, right) => compareTechnicalValues(left.fecha, right.fecha, "date"));
}

export function buildOmieMonthlyAnalysisDailyColumnValue(columnId: string, row: OmieMonthlyAnalysisTableRow): OmieMonthlyAnalysisDailyCellValue {
  const isSummaryRow = "rows" in row;
  switch (columnId) {
    case "fecha":
      return row.fecha;
    case "clave": {
      if (!isSummaryRow) {
        return row.clave;
      }
      const uniqueKeys = [...new Set(row.rows.map((item) => item.clave).filter(Boolean))];
      if (uniqueKeys.length === 0) {
        return "";
      }
      if (uniqueKeys.length === 1) {
        return uniqueKeys[0];
      }
      return `${uniqueKeys.length} claves`;
    }
    case "programaMd":
      return row.programaMd;
    case "volIda1":
      return row.volIda1;
    case "volIda2":
      return row.volIda2;
    case "volIda3":
      return row.volIda3;
    case "volXbid":
      return row.volXbid;
    case "energiaTotal":
      return isSummaryRow ? row.energiaTotal : omieMonthlyPeriodEnergyTotal(row);
    case "profitIda1":
      return row.profitIda1;
    case "profitIda2":
      return row.profitIda2;
    case "profitIda3":
      return row.profitIda3;
    case "profitXbid":
      return row.profitXbid;
    case "sumaProfit":
      return isSummaryRow ? row.profitTotal : row.sumaProfit;
    case "profitMedioEurMWh":
      return isSummaryRow ? row.profitMedioEurMWh : row.profitXbidEurMWh;
    case "precioMd":
      return isSummaryRow ? meanPrice(row.rows.map((item) => item.precioMd)) : row.precioMd;
    case "precioIda1":
      return isSummaryRow ? meanPrice(row.rows.map((item) => item.precioIda1)) : row.precioIda1;
    case "precioIda2":
      return isSummaryRow ? meanPrice(row.rows.map((item) => item.precioIda2)) : row.precioIda2;
    case "precioIda3":
      return isSummaryRow ? meanPrice(row.rows.map((item) => item.precioIda3)) : row.precioIda3;
    case "precioXbid":
      return isSummaryRow ? meanPrice(row.rows.map((item) => item.precioXbid)) : row.precioXbid;
    case "programaIda1":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.programaIda1)) : row.programaIda1;
    case "programaIda2":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.programaIda2)) : row.programaIda2;
    case "programaIda3":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.programaIda3)) : row.programaIda3;
    case "pciMdIda1":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.pciMdIda1)) : row.pciMdIda1;
    case "pciIda1Ida2":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.pciIda1Ida2)) : row.pciIda1Ida2;
    case "pciIda2Ida3":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.pciIda2Ida3)) : row.pciIda2Ida3;
    case "pciIda3Xbid":
      return isSummaryRow ? nullableNumericSum(row.rows.map((item) => item.pciIda3Xbid)) : row.pciIda3Xbid;
    case "profitXbidEurMWh":
      return isSummaryRow ? meanPrice(row.rows.map((item) => item.profitXbidEurMWh)) : row.profitXbidEurMWh;
    default:
      return "";
  }
}

export function buildOmieMonthlyAnalysisDailyColumnRender(columnId: string, value: OmieMonthlyAnalysisDailyCellValue) {
  switch (columnId) {
    case "fecha":
      return null;
    case "programaMd":
    case "volIda1":
    case "volIda2":
    case "volIda3":
    case "volXbid":
    case "energiaTotal":
    case "programaIda1":
    case "programaIda2":
    case "programaIda3":
    case "pciMdIda1":
    case "pciIda1Ida2":
    case "pciIda2Ida3":
    case "pciIda3Xbid":
      return formatOmieEnergy(value);
    case "profitIda1":
    case "profitIda2":
    case "profitIda3":
    case "profitXbid":
    case "sumaProfit":
      return formatOmieProfit(value);
    case "profitMedioEurMWh":
    case "profitXbidEurMWh":
      return formatOmieProfitRate(value);
    case "precioMd":
    case "precioIda1":
    case "precioIda2":
    case "precioIda3":
    case "precioXbid":
      return formatOmiePrice(value);
    case "clave":
      return stringifyCellValue(value) || "-";
    default:
      return stringifyCellValue(value) || "-";
  }
}

export function buildOmieMonthlyAnalysisTotalsRow(rows: OmieAnalisisMensualPeriodo[]): Record<string, ReactNode> {
  const energiaTotal = nullableNumericSum(rows.map(omieMonthlyPeriodEnergyTotal));
  const sumaProfit = nullableNumericSum(rows.map((row) => row.sumaProfit));

  return {
    fecha: "Total / Media",
    periodo: "",
    clave: `${rows.length} periodos`,
    precioMd: formatOmiePrice(meanPrice(rows.map((row) => row.precioMd))),
    precioIda1: formatOmiePrice(meanPrice(rows.map((row) => row.precioIda1))),
    precioIda2: formatOmiePrice(meanPrice(rows.map((row) => row.precioIda2))),
    precioIda3: formatOmiePrice(meanPrice(rows.map((row) => row.precioIda3))),
    precioXbid: formatOmiePrice(meanPrice(rows.map((row) => row.precioXbid))),
    programaMd: formatOmieEnergy(sumNumbers(rows.map((row) => row.programaMd))),
    programaIda1: formatOmieEnergy(sumNumbers(rows.map((row) => row.programaIda1))),
    programaIda2: formatOmieEnergy(sumNumbers(rows.map((row) => row.programaIda2))),
    programaIda3: formatOmieEnergy(sumNumbers(rows.map((row) => row.programaIda3))),
    volIda1: formatOmieEnergy(sumNumbers(rows.map((row) => row.volIda1))),
    volIda2: formatOmieEnergy(sumNumbers(rows.map((row) => row.volIda2))),
    volIda3: formatOmieEnergy(sumNumbers(rows.map((row) => row.volIda3))),
    volXbid: formatOmieEnergy(sumNumbers(rows.map((row) => row.volXbid))),
    energiaTotal: formatOmieEnergy(energiaTotal),
    profitIda1: formatOmieProfit(sumNumbers(rows.map((row) => row.profitIda1))),
    profitIda2: formatOmieProfit(sumNumbers(rows.map((row) => row.profitIda2))),
    profitIda3: formatOmieProfit(sumNumbers(rows.map((row) => row.profitIda3))),
    profitXbid: formatOmieProfit(sumNumbers(rows.map((row) => row.profitXbid))),
    sumaProfit: formatOmieProfit(sumNumbers(rows.map((row) => row.sumaProfit))),
    profitMedioEurMWh: formatOmieProfitRate(omieProfitRate(sumaProfit, energiaTotal))
  };
}

export function buildOmieMonthlyAnalysisKpis(analisis: OmieAnalisisMensualResponse): OmieDetalleCargaKpi[] {
  return [
    { label: "Suma Profit", value: formatOmieProfit(analisis.kpis.sumaProfit), tone: omieProfitKpiTone(analisis.kpis.sumaProfit) },
    { label: "Vol. Total", value: `${formatOmieEnergy(analisis.kpis.volumenTotal)} MWh`, tone: "neutral" },
    { label: "Energ�a Total", value: `${formatOmieEnergy(analisis.kpis.energiaTotal)} MWh`, tone: analisis.kpis.energiaTotal === null ? "warning" : "good" },
    { label: "Profit Medio �/MWh", value: formatOmieProfitRate(analisis.kpis.profitMedioEurMWh), tone: omieProfitKpiTone(analisis.kpis.profitMedioEurMWh) }
  ];
}

export function buildOmieMonthlyDailyRowsV2(rows: OmieAnalisisMensualPeriodo[]): OmieAnalisisDailyRow[] {
  return buildHierarchyWithAggregates(rows, OMIE_MONTHLY_ANALYSIS_DAY_LEVELS, OMIE_MONTHLY_ANALYSIS_DAY_AGGREGATES).map((node) => ({
    fecha: node.key,
    diaSemana: formatWeekdayName(node.key),
    periodos: node.rows.length,
    programaMd: readOmieMonthlyAnalysisAggregateValue(node.aggregates.programaMd),
    volIda1: readOmieMonthlyAnalysisAggregateValue(node.aggregates.volIda1),
    volIda2: readOmieMonthlyAnalysisAggregateValue(node.aggregates.volIda2),
    volIda3: readOmieMonthlyAnalysisAggregateValue(node.aggregates.volIda3),
    volXbid: readOmieMonthlyAnalysisAggregateValue(node.aggregates.volXbid),
    energiaTotal: readOmieMonthlyAnalysisAggregateValue(node.aggregates.energiaTotal),
    profitIda1: readOmieMonthlyAnalysisAggregateValue(node.aggregates.profitIda1),
    profitIda2: readOmieMonthlyAnalysisAggregateValue(node.aggregates.profitIda2),
    profitIda3: readOmieMonthlyAnalysisAggregateValue(node.aggregates.profitIda3),
    profitXbid: readOmieMonthlyAnalysisAggregateValue(node.aggregates.profitXbid),
    profitTotal: readOmieMonthlyAnalysisAggregateValue(node.aggregates.profitTotal),
    profitMedioEurMWh: readOmieMonthlyAnalysisAggregateValue(node.aggregates.profitMedioEurMWh),
    rows: [...node.rows]
  }));
}

export function sortOmieMonthlyAnalysisRows(rows: OmieAnalisisMensualPeriodo[]) {
  return [...rows].sort((left, right) => {
    return (
      compareTechnicalValues(left.fecha, right.fecha, "date") ||
      compareTechnicalValues(left.periodo, right.periodo, "number") ||
      compareTechnicalValues(left.clave, right.clave, "text")
    );
  });
}

export function omieMonthlyAnalysisQuality(row: OmieAnalisisMensualPeriodo): { tone: "ok" | "warning" | "danger"; labels: string[] } {
  if (!hasOmieMonthlyOperationalData(row)) {
    return { tone: "ok", labels: ["Sin datos descargados para el periodo"] };
  }
  return { tone: "ok", labels: [] };
}

export function hasOmieMonthlyOperationalData(row: OmieAnalisisMensualPeriodo) {
  return [
    row.precioMd,
    row.precioIda1,
    row.precioIda2,
    row.precioIda3,
    row.precioXbid,
    row.programaMd,
    row.programaIda1,
    row.programaIda2,
    row.programaIda3,
    row.volXbid,
    row.profitXbid
  ].some((value) => value !== null && value !== undefined);
}

export function omieMonthlyPeriodEnergyTotal(row: OmieAnalisisMensualPeriodo) {
  return nullableNumericSum([row.programaMd, row.volIda1, row.volIda2, row.volIda3, row.volXbid]);
}

export function omieMonthlyPeriodProfitRate(row: OmieAnalisisMensualPeriodo) {
  return omieProfitRate(row.sumaProfit, omieMonthlyPeriodEnergyTotal(row));
}

export function technicalColumnVisibility<T>(column: OmieDetalleCargaTechnicalColumn<T>): "basic" | "advanced" {
  return column.visibility ?? (column.advanced ? "advanced" : "basic");
}

export function buildTechnicalPresetHiddenColumns<T>(columns: Array<OmieDetalleCargaTechnicalColumn<T>>, mode: "basic" | "advanced") {
  if (mode === "advanced") {
    return new Set<string>();
  }

  return new Set(columns.filter((column) => technicalColumnVisibility(column) === "advanced").map((column) => column.id));
}

export function buildTechnicalColumnsSignature<T>(columns: Array<OmieDetalleCargaTechnicalColumn<T>>) {
  return columns.map((column) => `${column.id}:${technicalColumnVisibility(column)}`).join("|");
}

export function technicalNumericToneClass<T>(column: OmieDetalleCargaTechnicalColumn<T>, numeric: number | undefined) {
  if (numeric === undefined) {
    return "";
  }
  if (column.numericTone === "neutral") {
    return "";
  }
  if (column.numericTone === "zero-danger") {
    return numeric === 0 ? "zero-danger" : "";
  }
  return numeric < 0 ? "negative" : numeric > 0 ? "positive" : "";
}

export function technicalCellClass<T>(column: OmieDetalleCargaTechnicalColumn<T>, part: "header" | "filter" | "data" | "total") {
  return `technical-cell ${part} ${column.align ?? (column.type === "number" ? "right" : "left")} ${column.sticky ? "sticky" : ""}`;
}

export function stickyCellStyle<T>(column: OmieDetalleCargaTechnicalColumn<T>, stickyOffsets: Map<string, number>) {
  if (!column.sticky) {
    return undefined;
  }

  return {
    left: stickyOffsets.get(column.id) ?? 0,
    width: column.width
  };
}

export function stringifyCellValue(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

export function exportTechnicalRows<T extends object>(name: string, columns: Array<OmieDetalleCargaTechnicalColumn<T>>, rows: T[], format: "csv" | "xls", totalsRow?: Record<string, ReactNode>) {
  void withGlobalLoading(
    () => {
      if (rows.length === 0) {
        return;
      }

      const table = [
        columns.map((column) => column.label),
        ...(totalsRow ? [columns.map((column) => stringifyTotalsCellValue(totalsRow[column.id]))] : []),
        ...rows.map((row) => columns.map((column) => stringifyCellValue(technicalExportValue(column, row))))
      ];

      if (format === "xls") {
        const html = `<table>${table
          .map((line, index) => `<tr>${line.map((cell) => `<${index === 0 ? "th" : "td"}>${escapeHtml(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`)
          .join("")}</table>`;
        downloadBlob(name, html, "application/vnd.ms-excel;charset=utf-8");
        return;
      }

      downloadBlob(name, table.map((line) => line.map(csvCell).join(";")).join("\n"), "text/csv;charset=utf-8");
    },
    { label: "Preparando exportaci�n" }
  );
}

export function copyTechnicalRows<T extends object>(columns: Array<OmieDetalleCargaTechnicalColumn<T>>, rows: T[], totalsRow?: Record<string, ReactNode>) {
  void withGlobalLoading(
    async () => {
      const text = [
        columns.map((column) => column.label).join("\t"),
        ...(totalsRow ? [columns.map((column) => stringifyTotalsCellValue(totalsRow[column.id])).join("\t")] : []),
        ...rows.map((row) => columns.map((column) => stringifyCellValue(technicalExportValue(column, row))).join("\t"))
      ].join("\n");
      await navigator.clipboard?.writeText(text);
    },
    { label: "Copiando datos" }
  );
}

function readOmieMonthlyAnalysisAggregateValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

function sumNumbers(values: Array<number | string | null | undefined>) {
  return values.reduce<number>((sum, value) => sum + (normalizeNumericValue(value) ?? 0), 0);
}

function nullableNumericSum(values: Array<number | string | null | undefined>) {
  const present = values
    .map((value) => normalizeNumericValue(value))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function meanPrice(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function omieProfitKpiTone(value: number | null | undefined): OmieDetalleCargaKpi["tone"] {
  return value === null || value === undefined || value === 0 ? "neutral" : value > 0 ? "good" : "danger";
}

export function omieProfitRate(profit: number | string | null | undefined, energy: number | string | null | undefined) {
  const numericProfit = normalizeNumericValue(profit);
  const numericEnergy = normalizeNumericValue(energy);
  return numericProfit === undefined || numericEnergy === undefined || numericEnergy === 0 ? null : numericProfit / numericEnergy;
}

function compareTechnicalValues(left: string | number | null | undefined, right: string | number | null | undefined, type?: "text" | "number" | "date") {
  if (type === "number") {
    return (normalizeNumericValue(left) ?? Number.NEGATIVE_INFINITY) - (normalizeNumericValue(right) ?? Number.NEGATIVE_INFINITY);
  }

  if (type === "date") {
    return dateSortTime(left) - dateSortTime(right);
  }

  return stringifyCellValue(left).localeCompare(stringifyCellValue(right), "es", { numeric: true, sensitivity: "base" });
}

function dateSortTime(value: string | number | null | undefined) {
  const text = stringifyCellValue(value);
  return parseDateText(text)?.date.getTime() ?? parseDateTimeValue(text)?.getTime() ?? 0;
}

function technicalExportValue<T>(column: OmieDetalleCargaTechnicalColumn<T>, row: T) {
  return column.exportValue ? column.exportValue(row) : column.value(row);
}

function stringifyTotalsCellValue(value: ReactNode) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function downloadBlob(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char] ?? char);
}

export function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

export function formatPrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 2)} €/MWh`;
}

export function formatOmieProfit(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 3)} €`;
}

export function formatOmieProfitRate(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : `${formatFixedDecimalNumber(numeric, 3)} €/MWh`;
}

export function formatOmieProfitRateValue(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 3);
}

export function formatOmieEnergy(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 3);
}

export function formatOmiePrice(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? "-" : formatFixedDecimalNumber(numeric, 2);
}

export function formatFixedDecimalNumber(value: number, decimals = 2) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${groupedInteger},${decimalPart}` : `${sign}${groupedInteger}`;
}

function formatDate(value?: string | null) {
  const parsed = parseDateText(value);
  return parsed ? new Intl.DateTimeFormat("es-ES").format(parsed.date) : "-";
}

function formatFullDate(value?: string | null) {
  const parsed = parseDateText(value);
  if (!parsed) {
    return "-";
  }

  return `${pad2(parsed.date.getUTCDate())}/${pad2(parsed.date.getUTCMonth() + 1)}/${parsed.date.getUTCFullYear()}`;
}

function formatDateTime(value?: string | null) {
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

function formatWeekdayName(value?: string | null) {
  const parsed = parseDateText(value);
  if (!parsed) {
    return "-";
  }
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" }).format(parsed.date);
}

function parseDateTimeValue(value?: string | null) {
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

function parseDateText(value?: string | null) {
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

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}
