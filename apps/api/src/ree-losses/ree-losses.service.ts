import { Injectable } from "@nestjs/common";
import { ReeSettlementVersion } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ReeLossesAnalyticsEngine } from "./analytics-engine.service";
import { ReeLossesQueryDto } from "./dto/ree-losses-query.dto";
import { ReeKFactorImporter } from "./k-factor-importer.service";
import { normalizePeriodo, normalizeTarifa, toIsoDate } from "./period-engine";
import { ReeLossesRegulatoryEngine } from "./regulatory-engine.service";
import {
  CacheEntry,
  DateRange,
  DistinctTextOptionRow,
  LossReportRow,
  MonthOptionRow,
  ReeLossesAnalyticsSummary,
  ReeLossesFilterOptions
} from "./ree-losses.types";

const FILTER_OPTIONS_CACHE_MS = 60000;
const PRISMA_POOL_RETRIES = 3;
const BOE_OPEN_END = new Date(Date.UTC(9999, 11, 31));
const REE_LOSSES_VERSIONS = ["A1", "C1", "C2", "C3", "C4", "C5"] as const;

@Injectable()
export class ReeLossesService {
  private filterOptionsCache?: CacheEntry<ReeLossesFilterOptions>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly importer: ReeKFactorImporter,
    private readonly regulatoryEngine: ReeLossesRegulatoryEngine,
    private readonly analyticsEngine: ReeLossesAnalyticsEngine
  ) {}

  async importKFactorFiles(files: Express.Multer.File[]) {
    const response = await this.importer.importKFactorFiles(files);
    this.filterOptionsCache = undefined;
    return response;
  }

  async listImports(query: { skip?: string; take?: string } = {}) {
    const skip = parseNonNegativeInteger(query.skip, 0);
    const take = Math.min(parseNonNegativeInteger(query.take, 200), 500);
    const [storedImports, syntheticImports] = await Promise.all([
      this.prisma.reeKFactorImport.findMany({
        orderBy: { importedAt: "desc" },
        take: 500
      }),
      this.syntheticKFactorImports()
    ]);
    const stored = storedImports.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      containerFileName: item.containerFileName,
      fileHash: item.fileHash,
      tipoArchivo: item.tipoArchivo,
      version: item.version,
      fechaInicio: item.fechaInicio ? toIsoDate(item.fechaInicio) : null,
      fechaFin: item.fechaFin ? toIsoDate(item.fechaFin) : null,
      status: item.status,
      errorMessage: item.errorMessage,
      importedAt: item.importedAt.toISOString(),
      totalRecords: item.totalRecords,
      validRecords: item.validRecords,
      invalidRecords: item.invalidRecords,
      duplicatedRecords: item.duplicatedRecords
    }));
    const storedKeys = new Set(stored.map(kFactorImportRangeKey));
    const combined = [
      ...stored,
      ...syntheticImports.filter((item) => !storedKeys.has(kFactorImportRangeKey(item)))
    ].sort((left, right) => new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime());

    return combined.slice(skip, skip + take);
  }

  async filterOptions(): Promise<ReeLossesFilterOptions> {
    const cached = readCache(this.filterOptionsCache);
    if (cached) {
      return cached;
    }

    await this.regulatoryEngine.ensureReferenceData();
    const [versions, months, tarifas, periodos] = await Promise.all([
      runWithPrismaRetry(() =>
        this.prisma.$queryRaw<DistinctTextOptionRow[]>`
          SELECT DISTINCT version::text AS value
          FROM ree_k_factor
          WHERE version IS NOT NULL
          ORDER BY value
        `
      ).then(normalizeTextOptionRows),
      runWithPrismaRetry(() =>
        this.prisma.$queryRaw<MonthOptionRow[]>`
          SELECT to_char(fecha, 'YYYY-MM') AS month
          FROM ree_k_factor
          GROUP BY to_char(fecha, 'YYYY-MM')
          ORDER BY month DESC
        `
      ).then(normalizeMonthOptionRows),
      runWithPrismaRetry(() =>
        this.prisma.$queryRaw<DistinctTextOptionRow[]>`
          SELECT DISTINCT value
          FROM (
            SELECT tarifa AS value FROM ree_k_factor
            UNION
            SELECT tarifa AS value FROM perdidas_boe
          ) options
          WHERE value IS NOT NULL AND btrim(value) <> ''
          ORDER BY value
        `
      ).then(normalizeTextOptionRows),
      runWithPrismaRetry(() =>
        this.prisma.$queryRaw<DistinctTextOptionRow[]>`
          SELECT DISTINCT value
          FROM (
            SELECT periodo AS value FROM ree_k_factor
            UNION
            SELECT periodo AS value FROM perdidas_boe
          ) options
          WHERE value IS NOT NULL AND btrim(value) <> ''
          ORDER BY value
        `
      ).then(normalizeTextOptionRows)
    ]);

    const options = {
      versions,
      months,
      tarifas,
      periodos,
      latestMonth: months[0] ?? null
    };
    this.filterOptionsCache = writeCache(options);
    return options;
  }

  async report(query: ReeLossesQueryDto) {
    const options = await this.filterOptions();
    const dateRange = buildReportDateRange(query, options.latestMonth);
    if (!dateRange) {
      return emptyReport(options.latestMonth);
    }

    const version = normalizeVersion(query.version);
    const tarifa = normalizeTarifa(query.tarifa);
    const periodo = normalizePeriodo(query.periodo);
    const context = await this.regulatoryEngine.buildPeriodContext();
    const [kFactors, boeLosses] = await Promise.all([
      this.loadKFactors({ dateRange, version, tarifa, periodo }),
      this.regulatoryEngine.loadBoeLosses()
    ]);
    const analysis = this.analyticsEngine.buildReport({
      kFactors,
      boeLosses,
      context,
      dateRange,
      version,
      tarifa,
      periodo
    });

    return {
      filters: {
        mes: query.mes ?? options.latestMonth,
        fechaInicio: toIsoDate(dateRange.gte),
        fechaFin: toIsoDate(new Date(Date.UTC(dateRange.lt.getUTCFullYear(), dateRange.lt.getUTCMonth(), dateRange.lt.getUTCDate() - 1))),
        version,
        tarifa,
        periodo
      },
      ...analysis
    };
  }

  async analyticsSummary(): Promise<ReeLossesAnalyticsSummary> {
    const months = await this.latestAvailableMonths(12);
    if (months.length === 0) {
      return emptyAnalyticsSummary();
    }

    const firstMonthRange = parseQueryMonthRange(months[0]);
    const latestMonth = months[months.length - 1];
    const latestMonthRange = parseQueryMonthRange(latestMonth);
    if (!firstMonthRange || !latestMonthRange) {
      return emptyAnalyticsSummary();
    }

    const dateRange = {
      gte: firstMonthRange.gte,
      lt: latestMonthRange.lt
    };
    const context = await this.regulatoryEngine.buildPeriodContext();
    const [kFactors, boeLosses] = await Promise.all([
      this.loadKFactors({ dateRange }),
      this.regulatoryEngine.loadBoeLosses()
    ]);
    const rows = this.analyticsEngine.buildRows(kFactors, boeLosses, context);
    const latestVersionByMonth = buildLatestVersionByMonth(rows, months);
    const latestRowsByMonth = rows.filter((row) => latestVersionByMonth.get(monthKey(row.fecha)) === row.version);
    const latestVersion = latestVersionByMonth.get(latestMonth) ?? null;
    const heatmapRows = summarizeHeatmapRows(
      latestRowsByMonth.filter((row) => monthKey(row.fecha) === latestMonth && (!latestVersion || row.version === latestVersion))
    );

    return {
      latestMonth,
      latestVersion,
      months,
      latestVersionByMonth: months
        .map((mes) => ({ mes, version: latestVersionByMonth.get(mes) }))
        .filter((item): item is { mes: string; version: string } => Boolean(item.version)),
      annualPeriodRows: summarizeAnnualPeriodRows(latestRowsByMonth),
      heatmapRows,
      versionComparison: summarizeVersionComparison(rows)
    };
  }

  private loadKFactors({
    dateRange,
    version,
    tarifa,
    periodo
  }: {
    dateRange: DateRange;
    version?: ReeSettlementVersion;
    tarifa?: string;
    periodo?: string;
  }) {
    return this.prisma.reeKFactor.findMany({
      where: {
        fecha: dateRange,
        version,
        tarifa,
        periodo
      },
      orderBy: [
        { fecha: "asc" },
        { hora: "asc" },
        { cuartohora: "asc" },
        { tarifa: "asc" },
        { periodo: "asc" },
        { tipoArchivo: "desc" },
        { createdAt: "desc" }
      ]
    });
  }

  private async latestAvailableMonths(take: number) {
    const rows = await runWithPrismaRetry(() =>
      this.prisma.$queryRaw<MonthOptionRow[]>`
        SELECT to_char(fecha, 'YYYY-MM') AS month
        FROM ree_k_factor
        GROUP BY to_char(fecha, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT ${take}
      `
    );

    return normalizeMonthOptionRows(rows).slice(0, take).reverse();
  }

  private async syntheticKFactorImports() {
    const rows = await runWithPrismaRetry(() =>
      this.prisma.$queryRaw<Array<{
        version: string;
        tipoArchivo: string;
        fechaInicio: Date;
        fechaFin: Date;
        importedAt: Date;
        totalRecords: number;
      }>>`
        SELECT
          version::text AS "version",
          tipo_archivo::text AS "tipoArchivo",
          min(fecha) AS "fechaInicio",
          max(fecha) AS "fechaFin",
          max(created_at) AS "importedAt",
          count(*)::int AS "totalRecords"
        FROM ree_k_factor
        GROUP BY version::text, tipo_archivo::text, to_char(fecha, 'YYYY-MM')
        ORDER BY "importedAt" DESC
        LIMIT 500
      `
    );

    return rows.map((row) => {
      const fechaInicio = toIsoDate(row.fechaInicio);
      const fechaFin = toIsoDate(row.fechaFin);
      const version = normalizeVersion(row.version) ?? null;
      const tipoArchivo = normalizeKFactorFileType(row.tipoArchivo);

      return {
        id: `synthetic-${version ?? "NA"}-${tipoArchivo ?? "NA"}-${fechaInicio}`,
        fileName: `${version ?? "C?"}_${(tipoArchivo ?? "KFACTOR").toLowerCase()}_${compactDate(fechaInicio)}_${compactDate(fechaFin)}`,
        containerFileName: null,
        fileHash: null,
        tipoArchivo,
        version,
        fechaInicio,
        fechaFin,
        status: "IMPORTED" as const,
        errorMessage: "Histórico reconstruido desde ree_k_factor; no existe registro de fichero original.",
        importedAt: row.importedAt.toISOString(),
        totalRecords: row.totalRecords,
        validRecords: row.totalRecords,
        invalidRecords: 0,
        duplicatedRecords: 0
      };
    });
  }
}

function buildLatestVersionByMonth(rows: LossReportRow[], months: string[]) {
  const versionsByMonth = new Map<string, Set<string>>();
  for (const row of rows) {
    const mes = monthKey(row.fecha);
    if (!months.includes(mes)) {
      continue;
    }
    const current = versionsByMonth.get(mes) ?? new Set<string>();
    current.add(row.version);
    versionsByMonth.set(mes, current);
  }

  const latestByMonth = new Map<string, string>();
  for (const [mes, versions] of versionsByMonth.entries()) {
    const latest = [...versions].sort(compareVersionDesc)[0];
    if (latest) {
      latestByMonth.set(mes, latest);
    }
  }
  return latestByMonth;
}

function summarizeAnnualPeriodRows(rows: LossReportRow[]) {
  const groups = new Map<string, LossReportRow[]>();
  for (const row of rows) {
    const key = [monthKey(row.fecha), row.version, row.tarifa, row.periodo].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const [mes, version, tarifa, periodo] = key.split("|");
      return {
        mes,
        version,
        tarifa,
        periodo,
        perdidaBoe: averageReportValues(group.map((row) => row.perdidaBoe)),
        perdidaFinal: averageReportValues(group.map((row) => row.perdidaFinal)),
        diferenciaVsBoe: averageReportValues(group.map((row) => row.diferenciaVsBoe)),
        diferenciaPct: averageReportValues(group.map((row) => row.diferenciaPct)),
        records: group.length
      };
    })
    .sort((left, right) =>
      left.mes.localeCompare(right.mes) ||
      left.tarifa.localeCompare(right.tarifa, "es", { numeric: true }) ||
      left.periodo.localeCompare(right.periodo, "es", { numeric: true })
    );
}

function summarizeHeatmapRows(rows: LossReportRow[]) {
  const groups = new Map<string, Array<number | null>>();
  for (const row of rows) {
    const key = [row.fecha, row.hora].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row.perdidaFinal]);
  }

  return [...groups.entries()]
    .map(([key, values]) => {
      const [fecha, hora] = key.split("|");
      return {
        fecha,
        hora: Number(hora),
        perdidaFinal: averageReportValues(values)
      };
    })
    .sort((left, right) => left.fecha.localeCompare(right.fecha) || left.hora - right.hora);
}

function summarizeVersionComparison(rows: LossReportRow[]) {
  const boeRows = rows.filter((row) => row.perdidaBoe !== null);
  const result = [
    {
      label: "BOE",
      value: averageReportValues(boeRows.map((row) => row.perdidaBoe)),
      records: boeRows.length
    }
  ];
  const versions = [...new Set(rows.map((row) => row.version))].sort(compareVersionAsc);
  for (const version of versions) {
    const versionRows = rows.filter((row) => row.version === version);
    result.push({
      label: version,
      value: averageReportValues(versionRows.map((row) => row.perdidaFinal)),
      records: versionRows.length
    });
  }
  return result;
}

function emptyAnalyticsSummary(): ReeLossesAnalyticsSummary {
  return {
    latestMonth: null,
    latestVersion: null,
    months: [],
    latestVersionByMonth: [],
    annualPeriodRows: [],
    heatmapRows: [],
    versionComparison: []
  };
}

function buildReportDateRange(query: ReeLossesQueryDto, latestMonth: string | null): DateRange | undefined {
  if (query.fechaInicio || query.fechaFin) {
    return parseQueryDateRange(query.fechaInicio, query.fechaFin);
  }

  const month = query.mes ?? latestMonth ?? undefined;
  return month ? parseQueryMonthRange(month) : undefined;
}

function parseQueryDateRange(fechaInicio?: string, fechaFin?: string): DateRange | undefined {
  const start = fechaInicio ? parseQueryDateOnly(fechaInicio) : undefined;
  const end = fechaFin ? parseQueryDateOnly(fechaFin) : undefined;
  if (!start && !end) {
    return undefined;
  }

  return {
    gte: start ?? new Date(Date.UTC(2021, 5, 1)),
    lt: end ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1)) : BOE_OPEN_END
  };
}

function parseQueryMonthRange(value: string): DateRange | undefined {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compactDate) {
    return buildMonthRange(Number(compactDate[1]), Number(compactDate[2]));
  }

  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    return buildMonthRange(Number(month[1]), Number(month[2]));
  }

  const isoDate = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (isoDate) {
    return buildMonthRange(Number(isoDate[1]), Number(isoDate[2]));
  }

  return undefined;
}

function parseQueryDateOnly(value: string) {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compactDate) {
    return new Date(Date.UTC(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3])));
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate) {
    return new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
  }

  return undefined;
}

function buildMonthRange(year: number, month: number): DateRange {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1))
  };
}

function normalizeVersion(value?: string) {
  const version = value?.trim().toUpperCase();
  return version && (REE_LOSSES_VERSIONS as readonly string[]).includes(version) ? (version as ReeSettlementVersion) : undefined;
}

function compareVersionAsc(left: string, right: string) {
  return versionRank(left) - versionRank(right);
}

function compareVersionDesc(left: string, right: string) {
  return versionRank(right) - versionRank(left);
}

function versionRank(value: string) {
  if (value === "A1") {
    return 0;
  }
  const match = /^C([1-5])$/.exec(value);
  return match ? Number(match[1]) : 0;
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function averageReportValues(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) {
    return null;
  }
  return roundTo(present.reduce((sum, value) => sum + value, 0) / present.length, 6);
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeKFactorFileType(value?: string) {
  const type = value?.trim().toUpperCase();
  return type === "KESTIMQH" || type === "KREALQH" ? type : null;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function kFactorImportRangeKey(item: { version: string | null; tipoArchivo: string | null; fechaInicio: string | null; fechaFin: string | null }) {
  return [item.version ?? "", item.tipoArchivo ?? "", item.fechaInicio ?? "", item.fechaFin ?? ""].join("|");
}

function compactDate(value: string) {
  return value.replace(/-/g, "");
}

function emptyReport(latestMonth: string | null) {
  return {
    filters: {
      mes: latestMonth,
      fechaInicio: null,
      fechaFin: null,
      version: null,
      tarifa: null,
      periodo: null
    },
    kpis: {
      perdidaMedia: null,
      perdidaMaxima: null,
      perdidaMinima: null,
      desviacionMediaVsBoe: null,
      diasAnomalos: 0,
      registrosIncompletos: 0,
      huecosDetectados: 0,
      archivosProcesados: 0,
      versionActivaUtilizada: null
    },
    rows: [],
    anomalies: ["No hay datos K cargados."],
    gaps: {
      totalMissing: 0,
      days: []
    }
  };
}

function normalizeMonthOptionRows(rows: MonthOptionRow[]) {
  return [...new Set(rows.map((row) => row.month).filter(isNonEmptyString))].sort((left, right) => right.localeCompare(left));
}

function normalizeTextOptionRows(rows: DistinctTextOptionRow[]) {
  return [...new Set(rows.map((row) => row.value?.trim()).filter(isNonEmptyString))].sort((left, right) =>
    left.localeCompare(right, "es", { numeric: true, sensitivity: "base" })
  );
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function readCache<T>(entry?: CacheEntry<T>) {
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

function writeCache<T>(value: T): CacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + FILTER_OPTIONS_CACHE_MS
  };
}

async function runWithPrismaRetry<T>(operation: () => Promise<T>, retries = PRISMA_POOL_RETRIES): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isPrismaPoolTimeout(error) || attempt === retries) {
        throw error;
      }

      await wait(150 * (attempt + 1));
    }
  }

  throw lastError;
}

function isPrismaPoolTimeout(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2024";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
