import type { RowQuality, TechnicalKpi } from "../../components/technical-data-table/TechnicalDataTableTypes";
import { monthDateRange } from "../../app-shell/AppState";
import type { MedidasView } from "../../app-shell/AppShellTypes";
import type { MedperFilters, MedperMonthlyConsumptionRow, MedperSummary, MedperqhRecord, ReeVersion } from "../../api";

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

export type MedperMonthlyOperationalSummaryRow = {
  month: string;
  versions: Record<ReeVersion, { pf: number | null; bc: number | null }>;
  totalPf: number;
  totalBc: number;
  difference: number;
  differencePct: number | null;
  tone: "good" | "warning" | "danger" | "pending";
  missingVersions: ReeVersion[];
};

export function buildMedperMonthlyOperationalSummary(rows: MedperMonthlyConsumptionRow[]): MedperMonthlyOperationalSummaryRow[] {
  const months = buildContinuousMonthKeys(rows.map((row) => row.month));
  const byMonthVersion = new Map(rows.map((row) => [`${row.month}|${row.version}`, row] as const));

    return months.map((month) => {
      const versions = Object.fromEntries(
        SUMMARY_VERSIONS.map((version) => {
          const row = byMonthVersion.get(`${month}|${version}`);
          const hasData = row?.hasData ?? false;
          return [
            version,
            {
              pf: hasData ? invertedSignedValue(row?.pfMwh) : null,
              bc: hasData ? invertedSignedValue(row?.bcMwh ?? row?.consumoMwh) : null
            }
          ];
        })
      ) as Record<ReeVersion, { pf: number | null; bc: number | null }>;
      const versionValues = SUMMARY_VERSIONS.map((version) => versions[version]);
      const hasAnyRealData = SUMMARY_VERSIONS.some((version) => byMonthVersion.get(`${month}|${version}`)?.hasData ?? false);
      const totalPf = sumNumeric(versionValues.map((value) => value.pf));
      const totalBc = sumNumeric(versionValues.map((value) => value.bc));
      const difference = totalPf - totalBc;
      const differencePct = Math.abs(totalBc) < 0.000001 ? null : Math.abs(difference) / Math.abs(totalBc);
      const missingVersions =
        hasAnyRealData
          ? SUMMARY_VERSIONS.filter((version) => !(byMonthVersion.get(`${month}|${version}`)?.hasData ?? false))
          : [...SUMMARY_VERSIONS];
    return {
      month,
      versions,
      totalPf,
      totalBc,
      difference,
      differencePct,
      tone: hasAnyRealData ? medperDifferenceTone(differencePct) : "pending",
      missingVersions
    };
  });
}

export function medperDifferenceTone(value: number | null): "good" | "warning" | "danger" | "pending" {
  if (value === null) {
    return "pending";
  }
  if (value < 0.01) {
    return "good";
  }
  if (value <= 0.05) {
    return "warning";
  }
  return "danger";
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
    row.negativeEnergy ? "Signo positivo no esperado seg?n parser" : "",
    row.bcMwh === null || row.bcMwh === undefined ? "BC vacío" : "",
    row.perdidasMwh === null || row.perdidasMwh === undefined ? "Pérdidas vacías" : "",
    row.pfMwh === null || row.pfMwh === undefined ? "PF vacío" : ""
  ].filter(Boolean);
  return { tone: row.bcPfInconsistent ? "danger" : labels.length > 0 ? "warning" : "ok", labels };
}

export function buildMedperqhKpis(rows: MedperqhRecord[]): TechnicalKpi[] {
  const anomalies = rows.filter((row) => medperqhQuality(row).tone !== "ok").length;
  return [
    { label: "Total registros", value: formatNumber(rows.length), meta: "página cargada" },
    { label: "BC medio", value: formatNumber(meanNumeric(rows.map((row) => row.bcMwh))), meta: "MWh" },
    { label: "Pérdidas medias", value: formatNumber(meanNumeric(rows.map((row) => row.perdidasMwh))), meta: "MWh" },
    { label: "Peaje dominante", value: dominantValue(rows.map((row) => row.peaje)) || "-", meta: "en página" },
    { label: "Anomalías", value: formatNumber(anomalies), meta: "BC/PF/signo/nulos", tone: anomalies > 0 ? "warning" : "good" },
    { label: "Última actualización", value: latestUpdate(rows.map((row) => row.file?.importedAt)), meta: "fichero MEDPER" }
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

export function formatRatio(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${formatFixedDecimalNumber(value * 100, 2)}%`;
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

function buildContinuousMonthKeys(values: string[]) {
  const parsed = values
    .map((value) => /^(\d{4})-(\d{2})$/.exec(value))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ year: Number(match[1]), month: Number(match[2]) }))
    .sort((left, right) => left.year - right.year || left.month - right.month);
  if (parsed.length === 0) {
    return [];
  }
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const months: string[] = [];
  let year = first.year;
  let month = first.month;
  while (year < last.year || (year === last.year && month <= last.month)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function invertedSignedValue(value: string | number | null | undefined) {
  const numeric = normalizeNumericValue(value);
  return numeric === undefined ? null : numeric * -1;
}
