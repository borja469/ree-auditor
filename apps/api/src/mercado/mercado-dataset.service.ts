import { BadRequestException, Injectable } from "@nestjs/common";
import { OmieTipoPrecio } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MERCADO_ESIOS_VARIABLES, MercadoEsiosVariable, MercadoIndicatorMappingService, MercadoResolvedIndicatorMapping } from "./mercado-indicator-mapping.service";

const DATASET_VARIABLES = MERCADO_ESIOS_VARIABLES;
const NUCLEAR_AVAILABLE_POWER_INDICATOR_ID = 474;

type MercadoDatasetVariable = MercadoEsiosVariable;

type MercadoIndicatorMapping = Partial<Record<MercadoDatasetVariable | "precioOmie", MercadoResolvedIndicatorMapping>>;

type BuildHourlyDatasetOptions = {
  fechaDesde?: string;
  fechaHasta?: string;
  geoId?: number;
  take?: number;
};

type CoverageDiagnosticsOptions = {
  fechaDesde?: string;
  fechaHasta?: string;
  geoId?: number;
};

type DatasetAccumulator = {
  sum: number;
  count: number;
};

type MercadoDatasetRow = {
  timestampUtc: string;
  datetimeLocal: string;
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
  season: "winter" | "spring" | "summer" | "autumn";
  isWeekend: boolean;
  precioOmie: number | null;
  demandaPrevista: number | null;
  eolica: number | null;
  fotovoltaica: number | null;
  termosolar: number | null;
  nuclear: number | null;
  nuclearDisponibleMw: number | null;
  hidraulicaUGH: number | null;
  hidraulicaNoUGH: number | null;
  bombeo: number | null;
  intercambios: number | null;
  missingVariables: string[];
  dataQualityStatus: "complete" | "partial" | "empty";
};

@Injectable()
export class MercadoDatasetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoIndicatorMappingService: MercadoIndicatorMappingService
  ) {}

  async buildHourlyDataset(options: BuildHourlyDatasetOptions) {
    const { startDate, endDate } = resolveDateRange(options);
    const mapping = await this.mercadoIndicatorMappingService.resolveDatasetMapping();
    const timestamps = buildHourlyTimestamps(startDate, endDate);
    const [priceMap, esiosMap, nuclearAvailabilityMap] = await Promise.all([
      this.loadOmieDailyMarketPrices(startDate, endDate),
      this.loadEsiosVariables(startDate, endDate, mapping, options.geoId),
      this.loadNuclearAvailablePower(startDate, endDate)
    ]);

    const rows = timestamps.map((timestamp) => buildDatasetRow(timestamp, priceMap, esiosMap, nuclearAvailabilityMap));
    const limitedRows = options.take && options.take > 0 ? rows.slice(0, options.take) : rows;

    return {
      filters: {
        fechaDesde: formatDateOnly(startDate),
        fechaHasta: formatDateOnly(endDate),
        geoId: options.geoId ?? null
      },
      mapping: serializeMapping(mapping),
      columns: {
        originales: ["precioOmie", ...DATASET_VARIABLES],
        derivadas: ["nuclearDisponibleMw"],
        calendario: ["timestampUtc", "datetimeLocal", "date", "year", "month", "day", "hour", "weekday", "season", "isWeekend"],
        calidad: ["missingVariables", "dataQualityStatus"]
      },
      totalRows: rows.length,
      returnedRows: limitedRows.length,
      rows: limitedRows
    };
  }

  async diagnoseCoverage(options: CoverageDiagnosticsOptions) {
    const { startDate, endDate } = resolveDateRange(options);
    const mapping = await this.mercadoIndicatorMappingService.resolveDatasetMapping();
    const expectedHours = buildHourlyTimestamps(startDate, endDate).map((timestamp) => timestamp.toISOString());
    const expectedSet = new Set(expectedHours);

    const variables = await Promise.all(
      DATASET_VARIABLES.map(async (variable) => {
        const config = mapping[variable];
        if (!config?.indicatorId) {
          return {
            variable,
            source: "EsiosIndicatorValue",
            status: "not_mapped",
            indicatorId: null,
            indicatorName: null,
            expectedHours: expectedHours.length,
            sourceRecords: 0,
            matchedRecords: 0,
            distinctHours: 0,
            firstAvailable: null,
            lastAvailable: null,
            coveragePct: 0,
            missingHours: expectedHours.slice(0, 100),
            missingHoursCount: expectedHours.length,
            probableReason: "Variable sin indicador mapeado.",
            recommendedAction: "Revisar MercadoIndicatorMappingService o confirmar mapping manualmente."
          };
        }

        const indicator = await this.prisma.esiosIndicator.findUnique({
          where: { indicatorId: config.indicatorId },
          select: { indicatorId: true, name: true, shortName: true }
        });
        const rows = await this.prisma.esiosIndicatorValue.findMany({
          where: {
            indicatorId: config.indicatorId,
            datetimeUtc: {
              gte: startDate,
              lt: addDays(endDate, 1)
            }
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
        const expectedGeoId = options.geoId ?? config.geoId ?? undefined;
        const expectedGeoKey = config.geoKey ?? undefined;
        const matchedRows = rows.filter((row) => {
          if (row.value === null || !row.datetimeUtc) {
            return false;
          }
          if (expectedGeoId !== undefined && row.geoId !== expectedGeoId) {
            return false;
          }
          if (expectedGeoKey !== undefined && row.geoKey !== expectedGeoKey) {
            return false;
          }
          return true;
        });
        const matchedHours = new Set(matchedRows.map((row) => truncateToUtcHour(row.datetimeUtc as Date).toISOString()).filter((timestamp) => expectedSet.has(timestamp)));
        const missingHours = expectedHours.filter((timestamp) => !matchedHours.has(timestamp));
        return {
          variable,
          source: "EsiosIndicatorValue",
          status: coverageStatus(expectedHours.length, matchedHours.size, rows.length, matchedRows.length),
          indicatorId: config.indicatorId,
          indicatorName: indicator?.name ?? indicator?.shortName ?? config.nombre ?? null,
          mappingStatus: config.status,
          mappingConfidence: config.confidence,
          expectedGeoId: expectedGeoId ?? null,
          expectedGeoKey: expectedGeoKey ?? null,
          expectedHours: expectedHours.length,
          sourceRecords: rows.length,
          matchedRecords: matchedRows.length,
          distinctHours: matchedHours.size,
          firstAvailable: matchedRows[0]?.datetimeUtc?.toISOString() ?? null,
          lastAvailable: matchedRows.at(-1)?.datetimeUtc?.toISOString() ?? null,
          coveragePct: expectedHours.length === 0 ? 100 : round((matchedHours.size / expectedHours.length) * 100),
          missingHours: missingHours.slice(0, 100),
          missingHoursCount: missingHours.length,
          probableReason: coverageReason(expectedHours.length, matchedHours.size, rows.length, matchedRows.length, expectedGeoId, expectedGeoKey),
          recommendedAction: coverageRecommendedAction(config.indicatorId, startDate, endDate, matchedHours.size, rows.length, matchedRows.length)
        };
      })
    );

    return {
      filters: {
        fechaDesde: formatDateOnly(startDate),
        fechaHasta: formatDateOnly(endDate),
        geoId: options.geoId ?? null
      },
      expectedHours: expectedHours.length,
      variables
    };
  }

  private async loadOmieDailyMarketPrices(startDate: Date, endDate: Date) {
    const rows = await this.prisma.omiePrice.findMany({
      where: {
        tipoPrecio: OmieTipoPrecio.MD,
        fechaPrograma: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: [{ fechaPrograma: "asc" }, { periodo: "asc" }]
    });

    const periodsByDate = new Map<string, Array<{ periodo: number; value: number }>>();
    for (const row of rows) {
      const dateKey = formatDateOnly(row.fechaPrograma);
      const periods = periodsByDate.get(dateKey) ?? [];
      periods.push({ periodo: row.periodo, value: Number(row.precioEurMWh.toString()) });
      periodsByDate.set(dateKey, periods);
    }

    const hourly = new Map<string, number>();
    for (const [dateKey, periods] of periodsByDate) {
      const hourlyBuckets = new Map<number, DatasetAccumulator>();
      const looksHourly = periods.length <= 24 && Math.max(...periods.map((period) => period.periodo), 0) <= 24;
      for (const period of periods) {
        const hour = looksHourly ? period.periodo : Math.ceil(period.periodo / 4);
        const bucket = hourlyBuckets.get(hour) ?? { sum: 0, count: 0 };
        bucket.sum += period.value;
        bucket.count += 1;
        hourlyBuckets.set(hour, bucket);
      }
      for (const [hour, bucket] of hourlyBuckets) {
        hourly.set(`${dateKey}T${String(hour - 1).padStart(2, "0")}:00:00.000Z`, round(bucket.sum / bucket.count));
      }
    }

    return hourly;
  }

  private async loadEsiosVariables(startDate: Date, endDate: Date, mapping: MercadoIndicatorMapping, requestedGeoId?: number) {
    const configured = Object.entries(mapping).filter((entry): entry is [MercadoDatasetVariable, MercadoResolvedIndicatorMapping] => {
      return entry[0] !== "precioOmie" && Number.isSafeInteger(entry[1]?.indicatorId ?? undefined);
    });
    if (configured.length === 0) {
      return new Map<string, Partial<Record<MercadoDatasetVariable, number>>>();
    }

    const indicatorIds = [...new Set(configured.map(([, config]) => config.indicatorId).filter((indicatorId): indicatorId is number => indicatorId !== null))];
    const rows = await this.prisma.esiosIndicatorValue.findMany({
      where: {
        indicatorId: { in: indicatorIds },
        datetimeUtc: {
          gte: startDate,
          lt: addDays(endDate, 1)
        },
        ...(requestedGeoId !== undefined ? { geoId: requestedGeoId } : {})
      },
      orderBy: [{ datetimeUtc: "asc" }, { indicatorId: "asc" }, { geoKey: "asc" }]
    });

    const variableByIndicator = new Map<number, Array<{ variable: MercadoDatasetVariable; geoId?: number; geoKey?: number }>>();
    for (const [variable, config] of configured) {
      if (config.indicatorId === null) {
        continue;
      }
      const current = variableByIndicator.get(config.indicatorId) ?? [];
      current.push({
        variable,
        geoId: requestedGeoId ?? config.geoId ?? undefined,
        geoKey: config.geoKey ?? undefined
      });
      variableByIndicator.set(config.indicatorId, current);
    }

    const accumulators = new Map<string, Partial<Record<MercadoDatasetVariable, DatasetAccumulator>>>();
    for (const row of rows) {
      if (!row.datetimeUtc || row.value === null) {
        continue;
      }
      const candidates = variableByIndicator.get(row.indicatorId) ?? [];
      for (const candidate of candidates) {
        if (candidate.geoId !== undefined && row.geoId !== candidate.geoId) {
          continue;
        }
        if (candidate.geoKey !== undefined && row.geoKey !== candidate.geoKey) {
          continue;
        }
        const hourKey = truncateToUtcHour(row.datetimeUtc).toISOString();
        const rowAccumulators = accumulators.get(hourKey) ?? {};
        const accumulator = rowAccumulators[candidate.variable] ?? { sum: 0, count: 0 };
        accumulator.sum += Number(row.value.toString());
        accumulator.count += 1;
        rowAccumulators[candidate.variable] = accumulator;
        accumulators.set(hourKey, rowAccumulators);
      }
    }

    const values = new Map<string, Partial<Record<MercadoDatasetVariable, number>>>();
    for (const [timestamp, rowAccumulators] of accumulators) {
      const next: Partial<Record<MercadoDatasetVariable, number>> = {};
      for (const variable of DATASET_VARIABLES) {
        const accumulator = rowAccumulators[variable];
        if (accumulator) {
          next[variable] = round(accumulator.sum / accumulator.count);
        }
      }
      values.set(timestamp, next);
    }
    return values;
  }

  private async loadNuclearAvailablePower(startDate: Date, endDate: Date) {
    const rows = await this.prisma.esiosIndicatorValue.findMany({
      where: {
        indicatorId: NUCLEAR_AVAILABLE_POWER_INDICATOR_ID,
        datetimeUtc: {
          gte: startDate,
          lt: addDays(endDate, 1)
        }
      },
      select: {
        datetimeUtc: true,
        value: true
      },
      orderBy: [{ datetimeUtc: "asc" }, { geoKey: "asc" }]
    });

    const values = new Map<string, number>();
    for (const row of rows) {
      if (!row.datetimeUtc || row.value === null) {
        continue;
      }
      const hourKey = truncateToUtcHour(row.datetimeUtc).toISOString();
      values.set(hourKey, round((values.get(hourKey) ?? 0) + Number(row.value.toString())));
    }
    return values;
  }
}

function buildDatasetRow(
  timestamp: Date,
  priceMap: Map<string, number>,
  esiosMap: Map<string, Partial<Record<MercadoDatasetVariable, number>>>,
  nuclearAvailabilityMap: Map<string, number>
): MercadoDatasetRow {
  const timestampUtc = timestamp.toISOString();
  const local = utcToMadridDateParts(timestamp);
  const esiosValues = esiosMap.get(timestampUtc) ?? {};
  const row = {
    timestampUtc,
    datetimeLocal: local.datetime,
    date: local.date,
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    weekday: local.weekday,
    season: seasonForMonth(local.month),
    isWeekend: local.weekday === 0 || local.weekday === 6,
    precioOmie: priceMap.get(timestampUtc) ?? null,
    demandaPrevista: esiosValues.demandaPrevista ?? null,
    eolica: esiosValues.eolica ?? null,
    fotovoltaica: esiosValues.fotovoltaica ?? null,
    termosolar: esiosValues.termosolar ?? null,
    nuclear: esiosValues.nuclear ?? null,
    nuclearDisponibleMw: nuclearAvailabilityMap.get(timestampUtc) ?? null,
    hidraulicaUGH: esiosValues.hidraulicaUGH ?? null,
    hidraulicaNoUGH: esiosValues.hidraulicaNoUGH ?? null,
    bombeo: esiosValues.bombeo ?? null,
    intercambios: esiosValues.intercambios ?? null
  };
  const missingVariables = ["precioOmie", ...DATASET_VARIABLES].filter((variable) => row[variable as keyof typeof row] === null);
  return {
    ...row,
    missingVariables,
    dataQualityStatus: missingVariables.length === 0 ? "complete" : missingVariables.length === DATASET_VARIABLES.length + 1 ? "empty" : "partial"
  };
}

function serializeMapping(mapping: MercadoIndicatorMapping) {
  return Object.fromEntries(["precioOmie", ...DATASET_VARIABLES].map((variable) => [variable, mapping[variable as keyof MercadoIndicatorMapping] ?? null]));
}

function resolveDateRange(options: BuildHourlyDatasetOptions) {
  if (!options.fechaDesde || !options.fechaHasta) {
    throw new BadRequestException("fechaDesde y fechaHasta son obligatorias.");
  }
  const startDate = parseDateOnly(options.fechaDesde);
  const endDate = parseDateOnly(options.fechaHasta);
  if (startDate.getTime() > endDate.getTime()) {
    throw new BadRequestException("fechaDesde no puede ser posterior a fechaHasta.");
  }
  return { startDate, endDate };
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new BadRequestException("La fecha debe tener formato YYYY-MM-DD.");
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new BadRequestException("Fecha no valida.");
  }
  return date;
}

function buildHourlyTimestamps(startDate: Date, endDate: Date) {
  const timestamps: Date[] = [];
  for (let current = new Date(startDate); current.getTime() < addDays(endDate, 1).getTime(); current = new Date(current.getTime() + 60 * 60 * 1000)) {
    timestamps.push(current);
  }
  return timestamps;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function truncateToUtcHour(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function utcToMadridDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    datetime: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00:00`,
    year,
    month,
    day,
    hour,
    weekday: weekdayIndex(date)
  };
}

function weekdayIndex(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value);
}

function seasonForMonth(month: number): MercadoDatasetRow["season"] {
  if (month === 12 || month <= 2) {
    return "winter";
  }
  if (month <= 5) {
    return "spring";
  }
  if (month <= 8) {
    return "summer";
  }
  return "autumn";
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function coverageStatus(expectedHours: number, distinctHours: number, sourceRecords: number, matchedRecords: number) {
  if (sourceRecords === 0) {
    return "absent";
  }
  if (matchedRecords === 0) {
    return "not_exposed";
  }
  if (distinctHours === 0) {
    return "not_exposed";
  }
  if (distinctHours >= expectedHours) {
    return "complete";
  }
  return "partial";
}

function coverageReason(expectedHours: number, distinctHours: number, sourceRecords: number, matchedRecords: number, expectedGeoId?: number, expectedGeoKey?: number) {
  if (sourceRecords === 0) {
    return "Indicador mapeado sin datos cargados en la ventana solicitada.";
  }
  if (matchedRecords === 0) {
    return `Hay datos para el indicador, pero no coinciden con el filtro de geografia esperado (${expectedGeoId ?? expectedGeoKey ?? "sin geografia"}).`;
  }
  if (distinctHours < expectedHours) {
    return `Cobertura parcial: faltan ${expectedHours - distinctHours} horas en la ventana solicitada.`;
  }
  return "Cobertura completa para la ventana solicitada.";
}

function coverageRecommendedAction(indicatorId: number, startDate: Date, endDate: Date, distinctHours: number, sourceRecords: number, matchedRecords: number) {
  const start = formatDateOnly(startDate);
  const end = formatDateOnly(endDate);
  if (sourceRecords === 0) {
    return `Descargar indicador ESIOS ${indicatorId} para ${start}..${end}: POST /api/esios/indicators/${indicatorId}/download con {"startDate":"${start}","endDate":"${end}"}.`;
  }
  if (matchedRecords === 0) {
    return "Revisar geoId/geoKey del mapping o ejecutar el dataset sin filtro geoId manual.";
  }
  if (distinctHours > 0) {
    return `Completar huecos descargando de nuevo el indicador ESIOS ${indicatorId} para ${start}..${end}.`;
  }
  return null;
}

function round(value: number) {
  return Number(value.toFixed(6));
}
