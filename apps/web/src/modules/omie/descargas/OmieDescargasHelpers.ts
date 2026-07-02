import type { OmieDailyBulkDownloadResponse, OmieDownloadCodigo, OmieDownloadControlFilters, OmieDownloadControlRow } from "../../../api";

export type OmieOperationalStatus = "PROCESADO" | "SIN_DATOS" | "ERROR" | "OMITIDO" | "PENDIENTE";

export type OmieExpectedDailyDownload = {
  key: string;
  codigoOmie: OmieDownloadCodigo;
  label: string;
  sesion: string | null;
};

export type OmieDailyCoverageItem = OmieExpectedDailyDownload & {
  status: OmieOperationalStatus;
  registros: number;
  message: string | null;
  originalMessage: string | null;
  downloadId: string | null;
};

export type OmieDailyCoverage = {
  date: string;
  expected: number;
  completed: number;
  missing: OmieDailyCoverageItem[];
  errors: OmieDailyCoverageItem[];
  sinDatos: OmieDailyCoverageItem[];
  omitted: OmieDailyCoverageItem[];
  processed: OmieDailyCoverageItem[];
  coveragePercent: number;
  items: OmieDailyCoverageItem[];
};

const OMIE_DAILY_SESSIONS = ["01", "02", "03", "04", "05", "06", "07"];

export function buildOmieDailyExpectedDownloads(): OmieExpectedDailyDownload[] {
  return [
    expectedItem("5302", null),
    expectedItem("5202", null),
    expectedItem("4125", null),
    expectedItem("4121", null),
    ...OMIE_DAILY_SESSIONS.map((sesion) => expectedItem("5608", sesion)),
    ...OMIE_DAILY_SESSIONS.map((sesion) => expectedItem("5603", sesion))
  ];
}

export function calculateOmieDailyCoverage(
  date: string,
  downloads: OmieDownloadControlRow[],
  latestDailyBulkDownload?: OmieDailyBulkDownloadResponse
): OmieDailyCoverage {
  const expected = buildOmieDailyExpectedDownloads();
  const bulkByKey = new Map(
    latestDailyBulkDownload?.fecha === date
      ? latestDailyBulkDownload.resultados.map((item) => [dailyKey(item.codigoOmie, item.sesion), item])
      : []
  );
  const rowsByKey = new Map<string, OmieDownloadControlRow>();

  for (const row of downloads) {
    if (!matchesDailyDate(row, date)) {
      continue;
    }
    const key = dailyKey(row.codigoOmie, row.sesion);
    const current = rowsByKey.get(key);
    if (!current || row.updatedAt.localeCompare(current.updatedAt) > 0) {
      rowsByKey.set(key, row);
    }
  }

  const items = expected.map<OmieDailyCoverageItem>((item) => {
    const bulk = bulkByKey.get(item.key);
    const row = rowsByKey.get(item.key);
    if (bulk) {
      return {
        ...item,
        status: bulk.estado,
        registros: bulk.registros,
        message: normalizeOmieErrorMessage(bulk.mensaje),
        originalMessage: bulk.mensaje,
        downloadId: bulk.downloadId
      };
    }
    if (row) {
      const status = row.estado === "ERROR" ? "ERROR" : row.estado === "PROCESADO" && row.registros === 0 ? "SIN_DATOS" : row.estado === "PROCESADO" ? "PROCESADO" : "PENDIENTE";
      return {
        ...item,
        status,
        registros: row.registros,
        message: normalizeOmieErrorMessage(row.mensajeError),
        originalMessage: row.mensajeError,
        downloadId: row.id
      };
    }
    return {
      ...item,
      status: "PENDIENTE",
      registros: 0,
      message: null,
      originalMessage: null,
      downloadId: null
    };
  });

  const processed = items.filter((item) => item.status === "PROCESADO");
  const sinDatos = items.filter((item) => item.status === "SIN_DATOS");
  const errors = items.filter((item) => item.status === "ERROR");
  const omitted = items.filter((item) => item.status === "OMITIDO");
  const missing = items.filter((item) => item.status === "PENDIENTE");
  const completed = processed.length + sinDatos.length + omitted.length;

  return {
    date,
    expected: expected.length,
    completed,
    missing,
    errors,
    sinDatos,
    omitted,
    processed,
    coveragePercent: expected.length > 0 ? Math.round((completed / expected.length) * 100) : 0,
    items
  };
}

export function normalizeOmieErrorMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }
  if (message.includes("EAI_AGAIN")) {
    return "Error DNS temporal";
  }
  if (message.includes("ENOTFOUND")) {
    return "Host OMIE no localizado";
  }
  if (message.includes("ETIMEDOUT")) {
    return "Tiempo de espera agotado";
  }
  if (message.includes("ECONNRESET")) {
    return "Conexion reiniciada";
  }
  if (/SOAP\s+Fault/i.test(message)) {
    return "Error devuelto por OMIE";
  }
  return message;
}

export function buildOmieOperationalSummaryText(coverage: OmieDailyCoverage) {
  const errorLines = coverage.errors.length
    ? coverage.errors.map((item) => `* ${formatCoverageItemLabel(item)}: ${item.message ?? "Error sin detalle"}`)
    : ["* Sin errores"];
  return [
    `OMIE ${coverage.date}`,
    "",
    `Procesadas: ${coverage.processed.length}`,
    `Sin datos: ${coverage.sinDatos.length}`,
    `Errores: ${coverage.errors.length}`,
    `Omitidas: ${coverage.omitted.length}`,
    "",
    "Errores:",
    ...errorLines,
    "",
    `Cobertura: ${coverage.completed}/${coverage.expected}`
  ].join("\n");
}

export function formatCoverageItemLabel(item: Pick<OmieExpectedDailyDownload, "codigoOmie" | "sesion">) {
  return item.sesion ? `${item.codigoOmie} S${item.sesion}` : item.codigoOmie;
}

export function buildOmieQuickFilter(kind: "today" | "lastBatch" | "errors" | "noData", current: OmieDownloadControlFilters, date: string): OmieDownloadControlFilters {
  if (kind === "errors") {
    return { ...current, estado: "ERROR" };
  }
  if (kind === "noData") {
    return { ...current, estado: "PROCESADO" };
  }
  if (!date) {
    return current;
  }
  return { ...current, fechaDesde: date, fechaHasta: date };
}

function expectedItem(codigoOmie: OmieDownloadCodigo, sesion: string | null): OmieExpectedDailyDownload {
  return {
    key: dailyKey(codigoOmie, sesion),
    codigoOmie,
    sesion,
    label: sesion ? `${codigoOmie} S${sesion}` : codigoOmie
  };
}

function dailyKey(codigoOmie: OmieDownloadCodigo, sesion: string | null | undefined) {
  return `${codigoOmie}|${sesion ?? ""}`;
}

function matchesDailyDate(row: OmieDownloadControlRow, date: string) {
  if (row.codigoOmie === "4121") {
    return row.fechaPrograma <= date && (row.fechaHasta ?? row.fechaPrograma) >= date;
  }
  return row.fechaPrograma === date;
}
