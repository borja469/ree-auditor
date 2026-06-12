import type { ReactNode } from "react";
import { withGlobalLoading } from "../../loading";
import type { TechnicalColumn, TechnicalDataMode, TechnicalSortDirection, RowQuality } from "./TechnicalDataTableTypes";

export function technicalColumnVisibility<T>(column: TechnicalColumn<T>): TechnicalDataMode {
  return column.visibility ?? (column.advanced ? "advanced" : "basic");
}

export function buildTechnicalPresetHiddenColumns<T>(columns: Array<TechnicalColumn<T>>, mode: TechnicalDataMode) {
  if (mode === "advanced") {
    return new Set<string>();
  }

  return new Set(columns.filter((column) => technicalColumnVisibility(column) === "advanced").map((column) => column.id));
}

export function buildTechnicalColumnsSignature<T>(columns: Array<TechnicalColumn<T>>) {
  return columns.map((column) => `${column.id}:${technicalColumnVisibility(column)}`).join("|");
}

export function technicalNumericToneClass<T>(column: TechnicalColumn<T>, numeric: number | undefined) {
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

export function technicalCellClass<T>(column: TechnicalColumn<T>, part: "header" | "filter" | "data" | "total") {
  return `technical-cell ${part} ${column.align ?? (column.type === "number" ? "right" : "left")} ${column.sticky ? "sticky" : ""}`;
}

export function stickyCellStyle<T>(column: TechnicalColumn<T>, stickyOffsets: Map<string, number>) {
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

export function stringifyTotalsCellValue(value: ReactNode) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function filterTechnicalRows<T extends object>(
  rows: T[],
  activeColumns: Array<TechnicalColumn<T>>,
  filters: Record<string, string>,
  search: string,
  sort?: { id: string; direction: TechnicalSortDirection }
) {
  const normalizedSearch = search.trim().toLowerCase();
  const nextRows = rows.filter((row) => {
    if (normalizedSearch) {
      const haystack = activeColumns.map((column) => stringifyCellValue(column.value(row))).join(" ").toLowerCase();
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return activeColumns.every((column) => {
      if (column.filter === "number") {
        const value = normalizeNumericValue(column.value(row));
        const min = normalizeNumericValue(filters[`${column.id}:min`]);
        const max = normalizeNumericValue(filters[`${column.id}:max`]);
        return (min === undefined || (value !== undefined && value >= min)) && (max === undefined || (value !== undefined && value <= max));
      }

      const filterValue = filters[column.id]?.trim();
      if (!filterValue) {
        return true;
      }

      const value = stringifyCellValue(column.value(row));
      return column.filter === "select" ? value === filterValue : value.toLowerCase().includes(filterValue.toLowerCase());
    });
  });

  if (!sort) {
    return nextRows;
  }

  const column = activeColumns.find((item) => item.id === sort.id);
  if (!column) {
    return nextRows;
  }

  return [...nextRows].sort((left, right) => compareTechnicalValues(column.value(left), column.value(right), column.type) * (sort.direction === "asc" ? 1 : -1));
}

export function compareTechnicalValues(left: string | number | null | undefined, right: string | number | null | undefined, type?: "text" | "number" | "date") {
  if (type === "number") {
    return (normalizeNumericValue(left) ?? Number.NEGATIVE_INFINITY) - (normalizeNumericValue(right) ?? Number.NEGATIVE_INFINITY);
  }

  if (type === "date") {
    return dateSortTime(left) - dateSortTime(right);
  }

  return stringifyCellValue(left).localeCompare(stringifyCellValue(right), "es", { numeric: true, sensitivity: "base" });
}

export function dateSortTime(value: string | number | null | undefined) {
  const text = stringifyCellValue(value);
  return parseDateText(text)?.date.getTime() ?? parseDateTimeValue(text)?.getTime() ?? 0;
}

export function buildTechnicalQuality<T extends object>(
  rows: T[],
  columns: Array<TechnicalColumn<T>>,
  getRowQuality: (row: T) => RowQuality,
  duplicateCounts: Map<string, number>
) {
  const totalCells = Math.max(rows.length * Math.max(columns.length, 1), 1);
  let nulls = 0;
  let anomalies = 0;
  for (const row of rows) {
    nulls += columns.filter((column) => stringifyCellValue(column.value(row)) === "" && !column.expectedEmpty?.(row)).length;
    if (getRowQuality(row).tone !== "ok") {
      anomalies += 1;
    }
  }
  const duplicatedRows = [...duplicateCounts.values()].reduce((sum, count) => sum + (count > 1 ? count : 0), 0);
  return {
    completeness: ((totalCells - nulls) / totalCells) * 100,
    nulls,
    anomalies,
    duplicates: duplicatedRows
  };
}

export function exportTechnicalRows<T extends object>(name: string, columns: Array<TechnicalColumn<T>>, rows: T[], format: "csv" | "xls", totalsRow?: Record<string, ReactNode>) {
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

export function copyTechnicalRows<T extends object>(columns: Array<TechnicalColumn<T>>, rows: T[], totalsRow?: Record<string, ReactNode>) {
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

export function technicalExportValue<T>(column: TechnicalColumn<T>, row: T) {
  return column.exportValue ? column.exportValue(row) : column.value(row);
}

export function formatCompleteness(value: number) {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)}%`;
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

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

export function downloadBlob(name: string, content: string, type: string) {
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
