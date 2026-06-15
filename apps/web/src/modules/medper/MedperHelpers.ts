import type { RowQuality, TechnicalKpi } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { monthDateRange } from "../../app-shell/AppState";
import type { MedidasView } from "../../app-shell/AppShellTypes";
import type { MedperFilters, MedperSummary, MedperqhRecord, ReeVersion } from "../../api";

const SUMMARY_VERSIONS: ReeVersion[] = ["C3", "C4", "C5"];
const EXPORT_PAGE_SIZE = 1000;

export async function loadMedperRecordPage<T>(
  loader: (filters: MedperFilters) => Promise<T[]>,
  filters: MedperFilters,
  page: number,
  pageSize: number
) {
  const rows = await loader({ ...filters, skip: page * pageSize, take: pageSize + 1 });
  return {
    rows: rows.slice(0, pageSize),
    hasNext: rows.length > pageSize
  };
}

export async function loadAllMedperRows<T>(loader: (filters: MedperFilters) => Promise<T[]>, filters: MedperFilters) {
  const rows: T[] = [];
  let skip = 0;

  while (true) {
    const page = await loader({ ...filters, skip, take: EXPORT_PAGE_SIZE });
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) {
      return rows;
    }
    skip += EXPORT_PAGE_SIZE;
  }
}

export function sanitizeMedperFiltersForView(view: MedidasView, value: MedperFilters) {
  if (view === "history") {
    return {} as MedperFilters;
  }

  const next: MedperFilters = {
    version: value.version,
    fecha: value.fecha
  };

  if (view === "summary") {
    return {
      version: value.version,
      fecha: value.fecha
    };
  }

  const monthRange = monthDateRange(value.fecha);

  if (view === "qh") {
    return {
      ...next,
      ...monthRange,
      codigoUnidad: value.codigoUnidad,
      peaje: value.peaje
    };
  }

  return {
    ...next,
    ...monthRange,
    codigoUnidad: value.codigoUnidad,
    peaje: value.peaje
  };
}

export function isLikelyMedperFileName(file: File) {
  return /(?:medper|meper)qh/i.test(file.name);
}

export function getMedperValidationByVersion(summary?: MedperSummary) {
  return SUMMARY_VERSIONS.map((version) => {
    const item = summary?.validation.byVersion.find((row) => row.version === version);
    return {
      version,
      missingQh: item?.missingQh ?? 0,
      negativeQhRecords: item?.negativeQhRecords ?? 0,
      inconsistentBcPfRecords: item?.inconsistentBcPfRecords ?? 0
    };
  });
}

export function aggregateMedperRows<T extends { bcMwh?: string | null; pfMwh?: string | null; perdidasMwh?: string | null }>(
  rows: T[],
  getCode: (row: T) => string
) {
  const groups = new Map<string, { code: string; bc: number; pf: number; losses: number }>();
  for (const row of rows) {
    const code = getCode(row);
    const current = groups.get(code) ?? { code, bc: 0, pf: 0, losses: 0 };
    current.bc += Number(row.bcMwh ?? 0);
    current.pf += Number(row.pfMwh ?? 0);
    current.losses += Number(row.perdidasMwh ?? 0);
    groups.set(code, current);
  }
  return [...groups.values()].sort((left, right) => left.code.localeCompare(right.code, "es"));
}

export function medperqhQuality(row: MedperqhRecord): RowQuality {
  const labels = [
    row.bcPfInconsistent ? "BC/PF incoherente" : "",
    row.negativeEnergy ? "Signo positivo no esperado segÃ¯Â¿Â½n parser" : "",
    row.bcMwh === null || row.bcMwh === undefined ? "BC vacÃ¯Â¿Â½o" : "",
    row.perdidasMwh === null || row.perdidasMwh === undefined ? "PÃ¯Â¿Â½rdidas vacÃ¯Â¿Â½as" : "",
    row.pfMwh === null || row.pfMwh === undefined ? "PF vacÃ¯Â¿Â½o" : ""
  ].filter(Boolean);
  return { tone: row.bcPfInconsistent ? "danger" : labels.length > 0 ? "warning" : "ok", labels };
}

export function buildMedperqhKpis(rows: MedperqhRecord[]): TechnicalKpi[] {
  const anomalies = rows.filter((row) => medperqhQuality(row).tone !== "ok").length;
  return [
    { label: "Total registros", value: formatNumber(rows.length), meta: "pÃ¯Â¿Â½gina cargada" },
    { label: "BC medio", value: formatNumber(meanNumeric(rows.map((row) => row.bcMwh))), meta: "MWh" },
    { label: "PÃ¯Â¿Â½rdidas medias", value: formatNumber(meanNumeric(rows.map((row) => row.perdidasMwh))), meta: "MWh" },
    { label: "Peaje dominante", value: dominantValue(rows.map((row) => row.peaje)) || "-", meta: "en pÃ¯Â¿Â½gina" },
    { label: "AnomalÃ¯Â¿Â½as", value: formatNumber(anomalies), meta: "BC/PF/signo/nulos", tone: anomalies > 0 ? "warning" : "good" },
    { label: "Ã¯Â¿Â½ltima actualizaciÃ¯Â¿Â½n", value: latestUpdate(rows.map((row) => row.file?.importedAt)), meta: "fichero MEDPER" }
  ];
}

export function sumNumeric(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (normalizeNumericValue(value) ?? 0), 0);
}

export function meanNumeric(values: Array<string | number | null | undefined>): number | null {
  const present = values.map(normalizeNumericValue).filter((value): value is number => value !== undefined);
  return present.length === 0 ? null : present.reduce<number>((sum, value) => sum + value, 0) / present.length;
}

export function dominantValue(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim();
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

export function latestUpdate(values: Array<string | null | undefined>) {
  const latest = values
    .map((value) => parseDateTimeValue(value)?.getTime())
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => right - left)[0];
  return latest === undefined ? "-" : formatDateTime(new Date(latest).toISOString());
}

export function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateTime(value?: string | null) {
  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return "-";
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

export function parseDateTimeValue(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatNumber(value: number | string | null | undefined) {
  const numeric = normalizeNumericValue(value);
  if (numeric === undefined) {
    return "-";
  }
  return formatDecimalNumber(numeric, 3);
}

export function formatPercentOf(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || Math.abs(total) < 0.000001) {
    return "-";
  }
  return `${formatFixedDecimalNumber((part / total) * 100, 2)}%`;
}

export function formatCurrency(value: number) {
  return `${formatFixedDecimalNumber(value, 2)} â‚¬`;
}

export function normalizeNumericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatMonthKeyLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[2]}/${match[1]}`;
}

function formatDecimalNumber(value: number, maxDecimals = 3) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(maxDecimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmedDecimals = decimalPart.replace(/0+$/, "");
  return trimmedDecimals ? `${sign}${groupedInteger},${trimmedDecimals}` : `${sign}${groupedInteger}`;
}

function formatFixedDecimalNumber(value: number, decimals = 2) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(decimals);
  const [integerPart, decimalPart = ""] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${groupedInteger},${decimalPart}` : `${sign}${groupedInteger}`;
}
