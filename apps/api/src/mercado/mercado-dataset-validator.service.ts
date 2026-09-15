import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MercadoDatasetService } from "./mercado-dataset.service";

const VALIDATED_VARIABLES = [
  "precioOmie",
  "demandaPrevista",
  "eolica",
  "fotovoltaica",
  "termosolar",
  "nuclear",
  "hidraulicaUGH",
  "hidraulicaNoUGH",
  "bombeo",
  "intercambios"
] as const;

const ESIOS_VARIABLES = VALIDATED_VARIABLES.filter((variable) => variable !== "precioOmie");

type ValidatedVariable = (typeof VALIDATED_VARIABLES)[number];

type DatasetRow = Record<ValidatedVariable, number | null> & {
  timestampUtc: string;
  datetimeLocal: string;
  date: string;
  missingVariables: string[];
  dataQualityStatus: "complete" | "partial" | "empty";
};

type MappingEntry = {
  indicatorId: number | null;
  nombre?: string | null;
  geoId?: number | null;
  geoKey?: number | null;
  confidence?: number;
  status?: string;
  warnings?: string[];
  alternatives?: unknown[];
};

type DatasetResponse = {
  filters: {
    fechaDesde: string;
    fechaHasta: string;
    geoId: number | null;
  };
  mapping: Record<string, MappingEntry | null>;
  totalRows: number;
  returnedRows: number;
  rows: DatasetRow[];
};

type ValidationOptions = {
  fechaDesde?: string;
  fechaHasta?: string;
  geoId?: number;
};

@Injectable()
export class MercadoDatasetValidatorService {
  private readonly logger = new Logger(MercadoDatasetValidatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoDatasetService: MercadoDatasetService
  ) {}

  async validateDataset(options: ValidationOptions) {
    const dataset = (await this.mercadoDatasetService.buildHourlyDataset(options)) as DatasetResponse;
    const warnings: string[] = [];
    const errors: string[] = [];

    const coverage = buildCoverage(dataset.rows, dataset.totalRows);
    const duplicatedHours = findDuplicatedHours(dataset.rows);
    const missingHours = findMissingHours(dataset.rows);
    const coverageByVariable = buildCoverageByVariable(dataset.rows);
    const missingVariables = buildMissingVariablesSummary(dataset.rows);
    const consistency = buildConsistencyReport(dataset.rows, duplicatedHours, missingHours);
    const mappingQuality = await this.validateMapping(dataset);

    if (duplicatedHours.length > 0) {
      errors.push(`Dataset Mercado con ${duplicatedHours.length} timestamps duplicados.`);
    }
    if (missingHours.length > 0) {
      errors.push(`Dataset Mercado con ${missingHours.length} saltos horarios internos.`);
    }
    for (const variable of coverageByVariable) {
      if (variable.coveragePct < 95) {
        warnings.push(`Cobertura baja en ${variable.variable}: ${variable.coveragePct}%.`);
      }
      const rangeWarning = validateRange(variable.variable, variable.min, variable.max);
      if (rangeWarning) {
        warnings.push(rangeWarning);
      }
    }

    const qualityScore = calculateQualityScore({
      temporalCoveragePct: coverage.temporalCoveragePct,
      averageVariableCoveragePct: average(coverageByVariable.map((item) => item.coveragePct)),
      duplicatedHours: duplicatedHours.length,
      inconsistencies: consistency.warnings.length + consistency.errors.length,
      mappingErrors: mappingQuality.errors.length
    });

    this.logValidationIssues([...warnings, ...mappingQuality.warnings], [...errors, ...mappingQuality.errors]);

    return {
      datasetSummary: {
        fechaDesde: dataset.filters.fechaDesde,
        fechaHasta: dataset.filters.fechaHasta,
        geoId: dataset.filters.geoId,
        rows: dataset.rows.length,
        variables: VALIDATED_VARIABLES.length,
        completeRows: dataset.rows.filter((row) => row.dataQualityStatus === "complete").length,
        partialRows: dataset.rows.filter((row) => row.dataQualityStatus === "partial").length,
        emptyRows: dataset.rows.filter((row) => row.dataQualityStatus === "empty").length
      },
      coverage,
      missingHours,
      duplicatedHours,
      missingVariables,
      coverageByVariable,
      consistency,
      mappingQuality,
      warnings: [...warnings, ...mappingQuality.warnings],
      errors: [...errors, ...mappingQuality.errors],
      qualityScore,
      qualityScoreFormula: "0.40*coberturaTemporal + 0.40*coberturaMediaVariables + penalizaciones(duplicados, inconsistencias, mapping). Penalizaciones: -2 por hora duplicada, -1 por inconsistencia, -10 por indicador/mapping con error. Resultado acotado entre 0 y 100."
    };
  }

  private async validateMapping(dataset: DatasetResponse) {
    const startDate = new Date(`${dataset.filters.fechaDesde}T00:00:00.000Z`);
    const endDate = new Date(`${dataset.filters.fechaHasta}T00:00:00.000Z`);
    const mappingReports = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const variable of ESIOS_VARIABLES) {
      const mapping = dataset.mapping[variable];
      if (!mapping || mapping.indicatorId === null) {
        errors.push(`Variable ${variable} sin mapeo de indicador ESIOS.`);
        mappingReports.push({
          variable,
          status: "error",
          mappingStatus: mapping?.status ?? "not_found",
          indicatorId: null,
          confidence: mapping?.confidence ?? 0,
          alternatives: mapping?.alternatives ?? [],
          records: 0,
          geographies: [],
          issues: mapping?.warnings?.length ? mapping.warnings : ["Sin mapeo configurado"]
        });
        continue;
      }

      const indicator = await this.prisma.esiosIndicator.findUnique({
        where: { indicatorId: mapping.indicatorId }
      });
      if (!indicator) {
        errors.push(`Indicador ESIOS ${mapping.indicatorId} no existe para ${variable}.`);
        mappingReports.push({
          variable,
          status: "error",
          mappingStatus: mapping.status ?? "unknown",
          indicatorId: mapping.indicatorId,
          confidence: mapping.confidence ?? null,
          alternatives: mapping.alternatives ?? [],
          records: 0,
          geographies: [],
          issues: ["Indicador no existe"]
        });
        continue;
      }

      const rows = await this.prisma.esiosIndicatorValue.findMany({
        where: {
          indicatorId: mapping.indicatorId,
          datetimeUtc: { gte: startDate, lt: addDays(endDate, 1) }
        },
        select: {
          datetimeUtc: true,
          geoId: true,
          geoKey: true,
          geoName: true,
          value: true
        },
        orderBy: [{ datetimeUtc: "asc" }, { geoKey: "asc" }]
      });

      const issues: string[] = [];
      if (rows.length === 0) {
        issues.push("Indicador sin datos en el periodo");
      }

      const geographies = uniqueGeographies(rows);
      if (mapping.status === "ambiguous") {
        issues.push("Mapping ambiguo pendiente de confirmacion manual");
      }
      if ((mapping.confidence ?? 100) < 70) {
        issues.push(`Confianza baja del mapping: ${mapping.confidence ?? 0}`);
      }
      if (mapping.geoId !== undefined && mapping.geoId !== null && rows.some((row) => row.geoId !== mapping.geoId)) {
        issues.push(`Existen datos con geoId distinto al esperado ${mapping.geoId}`);
      }
      if (mapping.geoKey !== undefined && mapping.geoKey !== null && rows.some((row) => row.geoKey !== mapping.geoKey)) {
        issues.push(`Existen datos con geoKey distinto al esperado ${mapping.geoKey}`);
      }
      if ((mapping.geoId === undefined || mapping.geoId === null) && (mapping.geoKey === undefined || mapping.geoKey === null) && geographies.length > 1) {
        issues.push("Varias geografias disponibles sin geoId/geoKey fijado en mapping");
      }

      const resolution = inferResolution(rows.map((row) => row.datetimeUtc).filter((value): value is Date => Boolean(value)));
      if (resolution !== "H" && resolution !== "QH" && rows.length > 0) {
        issues.push(`Resolucion irregular detectada: ${resolution}`);
      }

      const nullValues = rows.filter((row) => row.value === null).length;
      if (nullValues > 0) {
        issues.push(`${nullValues} valores nulos en origen`);
      }

      for (const issue of issues) {
        const message = `${variable} (${mapping.indicatorId}): ${issue}.`;
        if (issue.includes("sin datos") || issue.includes("no existe")) {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }

      mappingReports.push({
        variable,
        status: issues.some((issue) => issue.includes("sin datos")) ? "error" : issues.length > 0 ? "warning" : "ok",
        mappingStatus: mapping.status ?? "unknown",
        indicatorId: mapping.indicatorId,
        indicatorName: indicator.name ?? indicator.shortName,
        confidence: mapping.confidence ?? null,
        alternatives: mapping.alternatives ?? [],
        expectedGeoId: mapping.geoId ?? null,
        expectedGeoKey: mapping.geoKey ?? null,
        records: rows.length,
        geographies,
        resolution,
        issues
      });
    }

    return {
      indicators: mappingReports,
      warnings,
      errors
    };
  }

  private logValidationIssues(warnings: string[], errors: string[]) {
    for (const warning of warnings) {
      this.logger.warn(warning);
    }
    for (const error of errors) {
      this.logger.error(error);
    }
  }
}

function buildCoverage(rows: DatasetRow[], expectedHours: number) {
  const existingHours = new Set(rows.map((row) => row.timestampUtc)).size;
  return {
    expectedHours,
    existingHours,
    missingHours: Math.max(expectedHours - existingHours, 0),
    duplicatedHours: rows.length - existingHours,
    temporalCoveragePct: expectedHours === 0 ? 100 : roundPct((existingHours / expectedHours) * 100)
  };
}

function buildCoverageByVariable(rows: DatasetRow[]) {
  return VALIDATED_VARIABLES.map((variable) => {
    const values = rows.map((row) => row[variable]).filter((value): value is number => value !== null && Number.isFinite(value));
    const nulls = rows.length - values.length;
    return {
      variable,
      total: rows.length,
      nulls,
      nullPct: rows.length === 0 ? 0 : roundPct((nulls / rows.length) * 100),
      coveragePct: rows.length === 0 ? 100 : roundPct((values.length / rows.length) * 100),
      min: values.length > 0 ? round(Math.min(...values)) : null,
      max: values.length > 0 ? round(Math.max(...values)) : null,
      mean: values.length > 0 ? round(average(values)) : null,
      stdDev: values.length > 1 ? round(stdDev(values)) : null,
      percentiles: values.length > 0 ? buildPercentiles(values) : null,
      repeatedValues: countRepeatedValues(values)
    };
  });
}

function buildMissingVariablesSummary(rows: DatasetRow[]) {
  return Object.fromEntries(VALIDATED_VARIABLES.map((variable) => [variable, rows.filter((row) => row[variable] === null).length]));
}

function buildConsistencyReport(rows: DatasetRow[], duplicatedHours: string[], missingHours: string[]) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const localHoursByDate = new Map<string, Set<string>>();
  const rowsByLocalDate = new Map<string, number>();
  for (const row of rows) {
    const hours = localHoursByDate.get(row.date) ?? new Set<string>();
    hours.add(row.datetimeLocal.slice(11, 13));
    localHoursByDate.set(row.date, hours);
    rowsByLocalDate.set(row.date, (rowsByLocalDate.get(row.date) ?? 0) + 1);
  }
  for (const [date, hours] of localHoursByDate) {
    const rowCount = rowsByLocalDate.get(date) ?? 0;
    if (rowCount >= 23 && hours.size !== 23 && hours.size !== 24 && hours.size !== 25) {
      warnings.push(`Dia local ${date} con ${hours.size} horas distintas. Puede ser cambio horario o hueco de datos.`);
    }
  }
  if (duplicatedHours.length > 0) {
    errors.push("Existen timestamps duplicados en dataset.");
  }
  if (missingHours.length > 0) {
    errors.push("Existen saltos horarios en dataset.");
  }
  return {
    duplicatedTimestamps: duplicatedHours.length,
    internalMissingHours: missingHours.length,
    warnings,
    errors
  };
}

function findDuplicatedHours(rows: DatasetRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.timestampUtc, (counts.get(row.timestampUtc) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([timestamp]) => timestamp);
}

function findMissingHours(rows: DatasetRow[]) {
  const sorted = [...new Set(rows.map((row) => row.timestampUtc))].sort();
  const missing: string[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = new Date(sorted[index - 1]).getTime();
    const current = new Date(sorted[index]).getTime();
    for (let expected = previous + 60 * 60 * 1000; expected < current; expected += 60 * 60 * 1000) {
      missing.push(new Date(expected).toISOString());
    }
  }
  return missing;
}

function validateRange(variable: ValidatedVariable, min: number | null, max: number | null) {
  if (min === null || max === null) {
    return undefined;
  }
  const ranges: Record<ValidatedVariable, [number, number]> = {
    precioOmie: [-500, 5000],
    demandaPrevista: [0, 60000],
    eolica: [0, 40000],
    fotovoltaica: [0, 35000],
    termosolar: [0, 10000],
    nuclear: [0, 10000],
    hidraulicaUGH: [0, 25000],
    hidraulicaNoUGH: [0, 15000],
    bombeo: [-15000, 15000],
    intercambios: [-20000, 20000]
  };
  const [expectedMin, expectedMax] = ranges[variable];
  if (min < expectedMin || max > expectedMax) {
    return `${variable} fuera de rango esperado [${expectedMin}, ${expectedMax}]: min=${min}, max=${max}.`;
  }
  return undefined;
}

function calculateQualityScore(params: {
  temporalCoveragePct: number;
  averageVariableCoveragePct: number;
  duplicatedHours: number;
  inconsistencies: number;
  mappingErrors: number;
}) {
  const base = params.temporalCoveragePct * 0.4 + params.averageVariableCoveragePct * 0.4 + 20;
  const penalty = params.duplicatedHours * 2 + params.inconsistencies + params.mappingErrors * 10;
  return Math.max(0, Math.min(100, round(base - penalty)));
}

function uniqueGeographies(rows: Array<{ geoId: number | null; geoKey: number; geoName: string | null }>) {
  const geographies = new Map<string, { geoId: number | null; geoKey: number; geoName: string | null; records: number }>();
  for (const row of rows) {
    const key = `${row.geoId ?? "null"}|${row.geoKey}`;
    const current = geographies.get(key) ?? { geoId: row.geoId, geoKey: row.geoKey, geoName: row.geoName, records: 0 };
    current.records += 1;
    geographies.set(key, current);
  }
  return [...geographies.values()];
}

function inferResolution(timestamps: Date[]) {
  const sorted = [...new Set(timestamps.map((timestamp) => timestamp.getTime()))].sort((left, right) => left - right);
  if (sorted.length < 2) {
    return "unknown";
  }
  const diffs = sorted.slice(1).map((timestamp, index) => timestamp - sorted[index]);
  const common = mostCommon(diffs);
  if (common === 15 * 60 * 1000) {
    return "QH";
  }
  if (common === 60 * 60 * 1000) {
    return "H";
  }
  return `irregular-${Math.round(common / 60000)}m`;
}

function mostCommon(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0;
}

function buildPercentiles(values: number[]) {
  return {
    p01: round(percentile(values, 0.01)),
    p05: round(percentile(values, 0.05)),
    p25: round(percentile(values, 0.25)),
    p50: round(percentile(values, 0.5)),
    p75: round(percentile(values, 0.75)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99))
  };
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function countRepeatedValues(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]) {
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function roundPct(value: number) {
  return Number(value.toFixed(2));
}
