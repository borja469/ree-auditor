import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ESIOS_DEFAULT_API_URL,
  ESIOS_DEFAULT_INDICATOR_ID,
  ESIOS_DEFAULT_INDICATORS,
  type EsiosConfigDto,
  type EsiosConfigInput,
  type EsiosConnectionResult,
  type EsiosDownloadSummary,
  type EsiosIndicatorCatalogItem,
  type EsiosIndicatorValueInput,
  type EsiosValuesQuery
} from "./esios.types";

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 5000;
const UPSERT_CHUNK_SIZE = 1000;

@Injectable()
export class EsiosApiService {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async ensureDefaults() {
    await this.getOrCreateConfig();
    for (const indicator of ESIOS_DEFAULT_INDICATORS) {
      await this.prisma.esiosIndicator.upsert({
        where: { indicatorId: indicator.indicatorId },
        create: {
          indicatorId: indicator.indicatorId,
          name: indicator.name,
          active: true
        },
        update: {
          active: true,
          name: indicator.name
        }
      });
    }
  }

  async getConfig(): Promise<EsiosConfigDto> {
    return serializeConfig(await this.getOrCreateConfig());
  }

  async updateConfig(input: EsiosConfigInput): Promise<EsiosConfigDto> {
    const current = await this.getOrCreateConfig();
    const apiUrl = input.apiUrl?.trim();
    const apiToken = input.apiToken;
    const timeoutSeconds = input.timeoutSeconds;
    const retries = input.retries;

    if (apiUrl !== undefined && !isValidHttpUrl(apiUrl)) {
      throw new BadRequestException("URL API no valida.");
    }
    if (timeoutSeconds !== undefined && (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600)) {
      throw new BadRequestException("Timeout debe estar entre 1 y 600 segundos.");
    }
    if (retries !== undefined && (!Number.isSafeInteger(retries) || retries < 0 || retries > 10)) {
      throw new BadRequestException("Reintentos debe estar entre 0 y 10.");
    }

    const updated = await this.prisma.esiosConfig.update({
      where: { id: current.id },
      data: {
        apiUrl: apiUrl ?? undefined,
        apiToken: apiToken === undefined ? undefined : apiToken.trim() || null,
        timeoutSeconds: timeoutSeconds ?? undefined,
        retries: retries ?? undefined,
        active: input.active ?? undefined
      }
    });
    return serializeConfig(updated);
  }

  async testConnection(): Promise<EsiosConnectionResult> {
    const config = await this.getOrCreateConfig();
    if (!config.active) {
      return { status: "inactive", message: "Integracion ESIOS inactiva." };
    }

    try {
      await this.requestJson("/indicators", config);
      return { status: "ok", message: "Conexion correcta" };
    } catch (error) {
      return classifyConnectionError(error);
    }
  }

  async getIndicators() {
    await this.ensureDefaults();
    const indicators = await this.prisma.esiosIndicator.findMany({
      include: {
        _count: {
          select: {
            values: true
          }
        },
        logs: {
          where: { status: "SUCCESS" },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { indicatorId: "asc" }
    });
    return indicators.map(serializeIndicator);
  }

  async getIndicator(indicatorId: number) {
    await this.ensureDefaults();
    const local = await this.prisma.esiosIndicator.findUnique({ where: { indicatorId } });
    if (local && local.name && local.unit) {
      return serializeIndicator(local);
    }

    const config = await this.getOrCreateConfig();
    const payload = await this.requestJson(`/indicators/${indicatorId}`, config);
    const remote = normalizeIndicatorPayload(payload, indicatorId);
    const saved = await this.upsertIndicator(remote);
    return serializeIndicator(saved);
  }

  async syncIndicators() {
    const config = await this.getOrCreateConfig();
    const payload = await this.requestJson("/indicators", config);
    const remoteIndicators = normalizeIndicatorsPayload(payload);
    let saved = 0;

    for (const indicator of remoteIndicators) {
      await this.upsertIndicator(indicator);
      saved += 1;
    }

    await this.ensureDefaults();
    return {
      downloadedRecords: remoteIndicators.length,
      savedRecords: saved,
      indicators: await this.getIndicators()
    };
  }

  async downloadIndicator(indicatorId: number, startDate: string, endDate: string): Promise<EsiosDownloadSummary> {
    const parsedStart = parseDateInput(startDate, "Fecha inicio");
    const parsedEnd = parseDateInput(endDate, "Fecha fin", true);
    if (parsedStart.getTime() > parsedEnd.getTime()) {
      throw new BadRequestException("Fecha inicio no puede ser posterior a fecha fin.");
    }

    const startedAt = Date.now();
    try {
      const config = await this.getOrCreateConfig();
      const payload = await this.requestJson(
        buildEsiosPath(`/indicators/${indicatorId}`, {
          start_date: formatEsiosDateTime(parsedStart),
          end_date: formatEsiosDateTime(parsedEnd),
          time_trunc: "hour",
          time_agg: "avg",
          locale: "es"
        }),
        config
      );
      const remoteIndicator = normalizeIndicatorPayload(payload, indicatorId);
      await this.upsertIndicator(remoteIndicator);
      const values = normalizeIndicatorValuesPayload(payload, indicatorId);
      const saveResult = await this.saveIndicatorValues(values);
      const summary: EsiosDownloadSummary = {
        indicatorId,
        startDate: parsedStart.toISOString(),
        endDate: parsedEnd.toISOString(),
        downloadedRecords: values.length,
        insertedRecords: saveResult.insertedRecords,
        updatedRecords: saveResult.updatedRecords,
        executionTimeMs: Date.now() - startedAt,
        status: "SUCCESS",
        errorMessage: null
      };
      await this.createDownloadLog(summary);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const summary: EsiosDownloadSummary = {
        indicatorId,
        startDate: parsedStart.toISOString(),
        endDate: parsedEnd.toISOString(),
        downloadedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        executionTimeMs: Date.now() - startedAt,
        status: "ERROR",
        errorMessage: message.slice(0, 4000)
      };
      await this.createDownloadLog(summary);
      throw new BadGatewayException(message || "Error descargando indicador ESIOS.");
    }
  }

  async saveIndicatorValues(values: EsiosIndicatorValueInput[]) {
    const uniqueValues = deduplicateIndicatorValues(values);
    if (uniqueValues.length === 0) {
      return { insertedRecords: 0, updatedRecords: 0 };
    }

    const existingKeys = await this.findExistingValueKeys(uniqueValues);
    for (const chunk of chunkArray(uniqueValues, UPSERT_CHUNK_SIZE)) {
      await this.upsertValuesChunk(chunk);
    }
    const updatedRecords = uniqueValues.filter((value) => existingKeys.has(valueKey(value.indicatorId, value.datetimeUtc ?? value.datetime, geoKey(value)))).length;
    return {
      insertedRecords: uniqueValues.length - updatedRecords,
      updatedRecords
    };
  }

  async getDemandForecast(query: EsiosValuesQuery) {
    return this.getIndicatorValues(ESIOS_DEFAULT_INDICATOR_ID, query);
  }

  async getIndicatorValues(indicatorId: number, query: EsiosValuesQuery) {
    await this.ensureDefaults();
    const range = resolveValuesRange(query);
    const take = clampTake(query.take);
    const skip = Math.max(query.skip ?? 0, 0);
    const where: Prisma.EsiosIndicatorValueWhereInput = {
      indicatorId,
      datetime: {
        gte: range.start,
        lte: range.end
      }
    };
    const [indicator, rows, total, aggregates, first, last, latestLog] = await Promise.all([
      this.prisma.esiosIndicator.findUnique({ where: { indicatorId } }),
      this.prisma.esiosIndicatorValue.findMany({
        where,
        orderBy: [{ datetime: "asc" }, { geoKey: "asc" }],
        skip,
        take
      }),
      this.prisma.esiosIndicatorValue.count({ where }),
      this.prisma.esiosIndicatorValue.aggregate({
        where,
        _avg: { value: true },
        _max: { value: true },
        _min: { value: true }
      }),
      this.prisma.esiosIndicatorValue.findFirst({ where, orderBy: { datetime: "asc" } }),
      this.prisma.esiosIndicatorValue.findFirst({ where, orderBy: { datetime: "desc" } }),
      this.prisma.esiosDownloadLog.findFirst({
        where: { indicatorId, status: "SUCCESS" },
        orderBy: { createdAt: "desc" }
      })
    ]);

    return {
      indicator: indicator ? serializeIndicator(indicator) : null,
      filters: {
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
        skip,
        take
      },
      total,
      hasNext: skip + rows.length < total,
      kpis: {
        firstRecord: first?.datetime.toISOString() ?? null,
        lastRecord: last?.datetime.toISOString() ?? null,
        totalRecords: total,
        average: decimalToNumber(aggregates._avg.value),
        maximum: decimalToNumber(aggregates._max.value),
        minimum: decimalToNumber(aggregates._min.value),
        latestDownload: latestLog?.createdAt.toISOString() ?? null
      },
      rows: rows.map(serializeValue)
    };
  }

  async getDownloadLogs(query: { indicatorId?: number; skip?: number; take?: number }) {
    const take = clampTake(query.take);
    const skip = Math.max(query.skip ?? 0, 0);
    const where: Prisma.EsiosDownloadLogWhereInput = {
      indicatorId: query.indicatorId
    };
    const [logs, total] = await Promise.all([
      this.prisma.esiosDownloadLog.findMany({
        where,
        include: { indicator: true },
        orderBy: { createdAt: "desc" },
        skip,
        take
      }),
      this.prisma.esiosDownloadLog.count({ where })
    ]);

    return {
      total,
      hasNext: skip + logs.length < total,
      logs: logs.map((log) => ({
        id: log.id.toString(),
        indicatorId: log.indicatorId,
        indicatorName: log.indicator?.name ?? null,
        startDate: log.startDate?.toISOString() ?? null,
        endDate: log.endDate?.toISOString() ?? null,
        downloadedRecords: log.downloadedRecords,
        insertedRecords: log.insertedRecords,
        updatedRecords: log.updatedRecords,
        executionTimeMs: log.executionTimeMs,
        status: log.status,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt.toISOString()
      }))
    };
  }

  private async getOrCreateConfig() {
    const current = await this.prisma.esiosConfig.findUnique({ where: { id: 1 } });
    if (current) {
      return current;
    }
    return this.prisma.esiosConfig.create({
      data: {
        id: 1,
        apiUrl: process.env.ESIOS_API_URL?.trim() || ESIOS_DEFAULT_API_URL,
        apiToken: process.env.ESIOS_API_TOKEN?.trim() || null,
        timeoutSeconds: numberEnv("ESIOS_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS),
        retries: numberEnv("ESIOS_RETRIES", DEFAULT_RETRIES),
        active: true
      }
    });
  }

  private async requestJson(path: string, config: { apiUrl: string; apiToken: string | null; timeoutSeconds: number; retries: number; active: boolean }) {
    if (!config.active) {
      throw new EsiosHttpError("Integracion ESIOS inactiva.", 0);
    }
    const token = config.apiToken?.trim() || process.env.ESIOS_API_TOKEN?.trim();
    if (!token) {
      throw new EsiosHttpError("Token API no configurado.", 401);
    }
    const baseUrl = config.apiUrl.replace(/\/+$/, "");
    const attempts = Math.max(config.retries, 0) + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(config.timeoutSeconds, 1) * 1000);
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-api-key": token
          }
        });
        const text = await response.text();
        if (!response.ok) {
          throw new EsiosHttpError(extractErrorMessage(text) ?? `Error API ESIOS ${response.status}.`, response.status);
        }
        return text ? JSON.parse(text) : {};
      } catch (error) {
        lastError = error;
        if (error instanceof EsiosHttpError && (error.statusCode === 401 || error.statusCode === 403 || error.statusCode < 500)) {
          throw error;
        }
        if (attempt === attempts - 1) {
          throw normalizeRequestError(error);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw normalizeRequestError(lastError);
  }

  private async upsertIndicator(indicator: EsiosIndicatorCatalogItem) {
    return this.prisma.esiosIndicator.upsert({
      where: { indicatorId: indicator.indicatorId },
      create: {
        indicatorId: indicator.indicatorId,
        name: indicator.name,
        description: indicator.description,
        shortName: indicator.shortName,
        unit: indicator.unit,
        frequency: indicator.frequency,
        active: indicator.active
      },
      update: {
        name: indicator.name,
        description: indicator.description,
        shortName: indicator.shortName,
        unit: indicator.unit,
        frequency: indicator.frequency
      }
    });
  }

  private async findExistingValueKeys(values: EsiosIndicatorValueInput[]) {
    const keys = new Set<string>();
    for (const chunk of chunkArray(values, UPSERT_CHUNK_SIZE)) {
      const rows = await this.prisma.esiosIndicatorValue.findMany({
        where: {
          OR: chunk.map((value) => ({
            indicatorId: value.indicatorId,
            ...(value.datetimeUtc ? { datetimeUtc: value.datetimeUtc } : { datetime: value.datetime }),
            geoKey: geoKey(value)
          }))
        },
        select: {
          indicatorId: true,
          datetime: true,
          datetimeUtc: true,
          geoKey: true
        }
      });
      for (const row of rows) {
        keys.add(valueKey(row.indicatorId, row.datetimeUtc ?? row.datetime, row.geoKey));
      }
    }
    return keys;
  }

  private async upsertValuesChunk(values: EsiosIndicatorValueInput[]) {
    const rows = values.map((value) => Prisma.sql`(
      ${value.indicatorId},
      ${value.datetime},
      ${value.datetimeUtc},
      ${value.value},
      ${value.geoId},
      ${geoKey(value)},
      ${value.geoName},
      now(),
      now()
    )`);
    await this.prisma.$executeRaw`
      INSERT INTO esios_indicator_values
        (indicator_id, datetime, datetime_utc, value, geo_id, geo_key, geo_name, created_at, updated_at)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (indicator_id, datetime_utc, geo_key)
      DO UPDATE SET
        datetime = EXCLUDED.datetime,
        datetime_utc = EXCLUDED.datetime_utc,
        value = EXCLUDED.value,
        geo_id = EXCLUDED.geo_id,
        geo_key = EXCLUDED.geo_key,
        geo_name = EXCLUDED.geo_name,
        updated_at = now()
    `;
  }

  private async createDownloadLog(summary: EsiosDownloadSummary) {
    await this.prisma.esiosDownloadLog.create({
      data: {
        indicatorId: summary.indicatorId,
        startDate: new Date(summary.startDate),
        endDate: new Date(summary.endDate),
        downloadedRecords: summary.downloadedRecords,
        insertedRecords: summary.insertedRecords,
        updatedRecords: summary.updatedRecords,
        executionTimeMs: summary.executionTimeMs,
        status: summary.status,
        errorMessage: summary.errorMessage
      }
    });
  }
}

function buildEsiosPath(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

function formatEsiosDateTime(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

class EsiosHttpError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function serializeConfig(config: { apiUrl: string; apiToken: string | null; timeoutSeconds: number; retries: number; active: boolean }): EsiosConfigDto {
  return {
    apiUrl: config.apiUrl,
    tokenConfigured: Boolean(config.apiToken?.trim() || process.env.ESIOS_API_TOKEN?.trim()),
    timeoutSeconds: config.timeoutSeconds,
    retries: config.retries,
    active: config.active
  };
}

function serializeIndicator(indicator: {
  id: bigint;
  indicatorId: number;
  name: string | null;
  description: string | null;
  shortName: string | null;
  unit: string | null;
  frequency: string | null;
  active: boolean;
  _count?: { values?: number };
  logs?: Array<{ createdAt: Date }>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: indicator.id.toString(),
    indicatorId: indicator.indicatorId,
    name: indicator.name,
    description: indicator.description,
    shortName: indicator.shortName,
    unit: indicator.unit,
    frequency: indicator.frequency,
    active: indicator.active,
    hasData: (indicator._count?.values ?? 0) > 0 || (indicator.logs?.length ?? 0) > 0,
    latestDownload: indicator.logs?.[0]?.createdAt?.toISOString() ?? null,
    createdAt: indicator.createdAt.toISOString(),
    updatedAt: indicator.updatedAt.toISOString()
  };
}

function serializeValue(value: {
  id: bigint;
  indicatorId: number;
  datetime: Date;
  datetimeUtc: Date | null;
  value: Prisma.Decimal | null;
  geoId: number | null;
  geoName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: value.id.toString(),
    indicatorId: value.indicatorId,
    datetime: value.datetime.toISOString(),
    datetimeUtc: value.datetimeUtc?.toISOString() ?? null,
    value: decimalToNumber(value.value),
    geoId: value.geoId,
    geoName: value.geoName,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString()
  };
}

function normalizeIndicatorsPayload(payload: unknown): EsiosIndicatorCatalogItem[] {
  const raw = payload && typeof payload === "object" && "indicators" in payload ? (payload as { indicators?: unknown }).indicators : payload;
  const array = Array.isArray(raw) ? raw : [];
  return array.map((item) => normalizeIndicatorPayload(item)).filter((item): item is EsiosIndicatorCatalogItem => Boolean(item));
}

function normalizeIndicatorPayload(payload: unknown, fallbackId?: number): EsiosIndicatorCatalogItem {
  const indicator = payload && typeof payload === "object" && "indicator" in payload ? (payload as { indicator?: unknown }).indicator : payload;
  const item = indicator && typeof indicator === "object" ? (indicator as Record<string, unknown>) : {};
  const indicatorId = toInteger(item.id) ?? fallbackId;
  if (!indicatorId) {
    throw new Error("Respuesta ESIOS sin identificador de indicador.");
  }
  return {
    indicatorId,
    name: toText(item.name),
    description: toText(item.description),
    shortName: toText(item.short_name) ?? toText(item.shortName),
    unit: readUnit(item),
    frequency: toText(item.frequency) ?? toText(item.granularity) ?? toText(item.time_trunc),
    active: true
  };
}

function normalizeIndicatorValuesPayload(payload: unknown, indicatorId: number): EsiosIndicatorValueInput[] {
  const indicator = payload && typeof payload === "object" && "indicator" in payload ? (payload as { indicator?: unknown }).indicator : payload;
  const values = indicator && typeof indicator === "object" && "values" in indicator ? (indicator as { values?: unknown }).values : undefined;
  const array = Array.isArray(values) ? values : [];
  return array
    .map((item) => normalizeIndicatorValue(item, indicatorId))
    .filter((item): item is EsiosIndicatorValueInput => Boolean(item));
}

function normalizeIndicatorValue(payload: unknown, indicatorId: number): EsiosIndicatorValueInput | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const item = payload as Record<string, unknown>;
  const datetime = parseDateValue(toText(item.datetime) ?? toText(item.date) ?? toText(item.datetime_local));
  if (!datetime) {
    return undefined;
  }
  const datetimeUtc = parseDateValue(toText(item.datetime_utc) ?? toText(item.datetimeUtc)) ?? datetime;
  const numeric = toNumber(item.value);
  return {
    indicatorId,
    datetime,
    datetimeUtc,
    value: numeric === null ? null : new Prisma.Decimal(numeric.toFixed(6)),
    geoId: toInteger(item.geo_id) ?? toInteger(item.geoId) ?? null,
    geoName: toText(item.geo_name) ?? toText(item.geoName)
  };
}

function deduplicateIndicatorValues(values: EsiosIndicatorValueInput[]) {
  const byKey = new Map<string, EsiosIndicatorValueInput>();
  for (const value of values) {
    byKey.set(valueKey(value.indicatorId, value.datetimeUtc ?? value.datetime, geoKey(value)), value);
  }
  return [...byKey.values()];
}

function readUnit(item: Record<string, unknown>) {
  const direct = toText(item.unit) ?? toText(item.measure_unit);
  if (direct) {
    return direct;
  }
  const magnitud = item.magnitud ?? item.magnitude;
  if (magnitud && typeof magnitud === "object") {
    const nested = magnitud as Record<string, unknown>;
    return toText(nested.name) ?? toText(nested.unit);
  }
  return null;
}

function resolveValuesRange(query: EsiosValuesQuery) {
  if (query.year && query.month) {
    const start = madridLocalDateTimeToUtc(query.year, query.month, 1);
    const end = new Date(
      madridLocalDateTimeToUtc(query.month === 12 ? query.year + 1 : query.year, query.month === 12 ? 1 : query.month + 1, 1).getTime() - 1
    );
    return { start, end };
  }

  if (query.year) {
    const start = madridLocalDateTimeToUtc(query.year, 1, 1);
    const end = new Date(madridLocalDateTimeToUtc(query.year + 1, 1, 1).getTime() - 1);
    return { start, end };
  }

  return {
    start: query.fechaDesde
      ? parseDateInput(query.fechaDesde, "Fecha desde")
      : madridLocalDateTimeToUtc(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    end: query.fechaHasta ? parseDateInput(query.fechaHasta, "Fecha hasta", true) : new Date()
  };
}

function parseDateInput(value: string, label: string, endOfDay = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${label} debe tener formato YYYY-MM-DD.`);
    }
    return parsed;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new BadRequestException(`${label} no es valida.`);
  }
  return endOfDay
    ? madridLocalDateTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 23, 59, 59, 999)
    : madridLocalDateTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0, 0);
}

function clampTake(value?: number) {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(value, 1), MAX_PAGE_SIZE);
}

function classifyConnectionError(error: unknown): EsiosConnectionResult {
  const normalized = normalizeRequestError(error);
  if (normalized instanceof EsiosHttpError && (normalized.statusCode === 401 || normalized.statusCode === 403)) {
    return { status: "invalid_token", message: "Token invalido", statusCode: normalized.statusCode };
  }
  if (normalized instanceof EsiosHttpError) {
    return { status: "api_error", message: normalized.message || "Error API", statusCode: normalized.statusCode };
  }
  return { status: "network_error", message: normalized.message || "Error de red" };
}

function normalizeRequestError(error: unknown) {
  if (error instanceof EsiosHttpError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Error("Tiempo de espera agotado conectando con ESIOS.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

function extractErrorMessage(text: string) {
  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
    return toText(payload.message) ?? toText(payload.error);
  } catch {
    return text.trim() || undefined;
  }
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : Number(value.toString());
}

function toText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) ? number : undefined;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function parseDateValue(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function valueKey(indicatorId: number, datetime: Date, resolvedGeoKey: number) {
  return `${indicatorId}|${datetime.toISOString()}|${resolvedGeoKey}`;
}

function geoKey(value: Pick<EsiosIndicatorValueInput, "geoId">) {
  return value.geoId ?? -1;
}

function madridLocalDateTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0) {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = madridDateParts(candidate);
    const candidateKey = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
      0
    );
    const targetKey = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const diffMinutes = (targetKey - candidateKey) / 60000;
    if (diffMinutes === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + diffMinutes * 60000);
  }

  return candidate;
}

function madridDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}
