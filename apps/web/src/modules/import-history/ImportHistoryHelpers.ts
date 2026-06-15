import { withGlobalLoading } from "../../loading";
import type { ImportHistoryFile, LoadSortKey, LoadStatus } from "../../app-shell/AppShellTypes";
import { downloadBlob } from "../../components/technical-data-table/TechnicalDataTableHelpers";
export function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return `${match[2]}/${match[1]}`;
}

export function formatFixedDecimalNumber(value: number, decimals = 2) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${groupedInteger},${decimalPart}` : `${sign}${groupedInteger}`;
}

export function buildImportHistoryCharts(files: ImportHistoryFile[]) {
  const monthlyLoads = aggregateFiles(files, getHistoryPeriodKey, () => 1).slice(-8);
  const monthlyInvalids = aggregateFiles(files, getHistoryPeriodKey, (file) => file.invalidRecords).slice(-8);
  const byVersion = aggregateFiles(files, (file) => file.version, (file) => file.totalRecords);

  return { monthlyLoads, monthlyInvalids, byVersion };
}

export function aggregateFiles(files: ImportHistoryFile[], getKey: (file: ImportHistoryFile) => string, getValue: (file: ImportHistoryFile) => number) {
  const map = new Map<string, number>();
  for (const file of files) {
    const key = getKey(file);
    map.set(key, (map.get(key) ?? 0) + getValue(file));
  }
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({ label, value }));
}

export function compareLoads(left: ImportHistoryFile, right: ImportHistoryFile, sortKey: LoadSortKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftValue = getLoadSortValue(left, sortKey);
  const rightValue = getLoadSortValue(right, sortKey);
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }
  return String(leftValue).localeCompare(String(rightValue), "es") * multiplier;
}

export function getLoadSortValue(file: ImportHistoryFile, sortKey: LoadSortKey) {
  switch (sortKey) {
    case "status":
      return getLoadStatus(file);
    case "type":
      return file.version;
    case "period":
      return getHistoryPeriodStart(file);
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

export function getLoadStatus(file: ImportHistoryFile): LoadStatus {
  if (file.status === "FAILED") {
    return "error";
  }
  if (file.status === "DUPLICATED" || file.invalidRecords > 0 || file.duplicatedRecords > 0) {
    return "partial";
  }
  return "valid";
}

export function qualityLabel(part: number, total: number) {
  return total > 0 ? `${formatFixedDecimalNumber((part / total) * 100, 2)}% del total` : "Sin registros";
}

export function toMonthKeyFromIso(value?: string | null) {
  return value?.slice(0, 7) ?? "";
}

export function getHistoryPeriodStart(file: ImportHistoryFile) {
  return "fechaLiquidacion" in file ? file.fechaLiquidacion : file.fechaInicio;
}

export function getHistoryPeriodKey(file: ImportHistoryFile) {
  return toMonthKeyFromIso(getHistoryPeriodStart(file));
}

export function getHistoryPeriodLabel(file: ImportHistoryFile) {
  if ("fechaLiquidacion" in file) {
    return formatDate(file.fechaLiquidacion);
  }

  return `${formatDate(file.fechaInicio)} - ${formatDate(file.fechaFin)}`;
}

export function exportLoadCsv(name: string, files: ImportHistoryFile[]) {
  exportCsv(name, files.map((file) => ({
    estado: getLoadStatus(file),
    tipo: file.version,
    tipoFichero: file.tipoArchivo,
    periodo: getHistoryPeriodLabel(file),
    archivo: file.fileName,
    registros: file.totalRecords,
    validos: file.validRecords,
    invalidos: file.invalidRecords,
    duplicados: file.duplicatedRecords,
    fechaCarga: formatDateTime(file.importedAt)
  })));
}

export function exportCsv<T extends object>(name: string, rows: T[]) {
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
    { label: "Preparando exportaciï¿½n" }
  );
}

export function safeExportName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "carga";
}

export function formatActionValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function flattenRow(row: object) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, value]) => typeof value !== "object" || value === null)
      .map(([key, value]) => [key, value])
  );
}

export function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

export function formatDate(value?: string | null) {
  const parsed = parseDateText(value);
  return parsed ? new Intl.DateTimeFormat("es-ES").format(parsed.date) : "-";
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

function normalizeNumericValue(value: number | string | null | undefined) {
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