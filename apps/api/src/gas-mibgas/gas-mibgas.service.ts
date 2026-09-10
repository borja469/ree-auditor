import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { GasMibgasDownloadResult, GasMibgasQuery, GasMibgasSyncResponse, GasMibgasSyncRunType, ParsedGasMibgasRow } from "./gas-mibgas.types";
import { MibgasDownloader } from "./mibgas-downloader";
import { MibgasParser, validateMibgasNaturalKey } from "./mibgas-parser";

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 10_000;
const DEFAULT_SCHEDULE_TIME = "22:30";

@Injectable()
export class GasMibgasService {
  private readonly parser = new MibgasParser();

  constructor(
    private readonly prisma: PrismaService,
    private readonly downloader: MibgasDownloader
  ) {}

  async syncYear(year: number, runType: GasMibgasSyncRunType = "MANUAL"): Promise<GasMibgasSyncResponse> {
    const normalizedYear = normalizeYear(year);
    let parseErrors: Array<{ row: number; message: string }> = [];
    let rowsRead = 0;
    let downloadUrl: string | null = null;
    let sourceFilename: string | null = null;
    let sourceEmissionDatetime: Date | null = null;
    const run = await this.prisma.gasMibgasSyncRun.create({
      data: {
        year: normalizedYear,
        runType,
        status: "STARTED",
        startedAt: new Date()
      }
    });

    try {
      const download = await this.downloader.downloadYear(normalizedYear);
      downloadUrl = download.url;
      const parsed = this.parser.parse(download.content, { year: normalizedYear, filename: download.filename });
      parseErrors = parsed.errors;
      rowsRead = parsed.rows.length;
      sourceFilename = parsed.filename;
      sourceEmissionDatetime = parsed.sourceEmissionDatetime;
      if (parsed.errors.length > 0) {
        throw new BadRequestException(`El fichero MIBGAS contiene ${parsed.errors.length} filas invalidas.`);
      }
      const keyValidation = validateMibgasNaturalKey(parsed.rows);
      if (keyValidation.duplicateRows > 0) {
        throw new BadRequestException(`La clave natural MIBGAS propuesta no es unica: ${keyValidation.duplicateRows} duplicados.`);
      }

      const result = await this.prisma.$transaction((tx) => this.persistRows(tx, parsed.rows));
      const finished = await this.prisma.gasMibgasSyncRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          url: downloadUrl,
          sourceFilename: parsed.filename,
          sourceEmissionDatetime: parsed.sourceEmissionDatetime,
          rowsRead: parsed.rows.length,
          insertedRows: result.inserted,
          updatedRows: result.updated,
          unchangedRows: result.unchanged,
          nullPriceRows: parsed.rows.filter((row) => row.priceEurMwh === null).length,
          errorRows: 0,
          errorMessage: null
        }
      });
      return toSyncResponse(finished, []);
    } catch (error) {
      const finished = await this.prisma.gasMibgasSyncRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          finishedAt: new Date(),
          url: downloadUrl,
          sourceFilename,
          sourceEmissionDatetime,
          rowsRead,
          errorRows: parseErrors.length,
          errorMessage: errorMessage(error).slice(0, 4000)
        }
      });
      return toSyncResponse(finished, parseErrors);
    }
  }

  async syncHistory(fromYear: number, toYear: number) {
    const start = normalizeYear(fromYear);
    const end = normalizeYear(toYear);
    if (start > end) {
      throw new BadRequestException("El ano inicial no puede ser posterior al ano final.");
    }
    const results: GasMibgasSyncResponse[] = [];
    for (let year = start; year <= end; year += 1) {
      results.push(await this.syncYear(year, "HISTORICAL"));
    }
    return {
      fromYear: start,
      toYear: end,
      success: results.filter((item) => item.status === "SUCCESS").length,
      errors: results.filter((item) => item.status === "ERROR").length,
      results
    };
  }

  async list(query: GasMibgasQuery) {
    const where = buildWhere(query);
    const [total, rows, products, places, areas] = await Promise.all([
      this.prisma.gasMibgasPrice.count({ where }),
      this.prisma.gasMibgasPrice.findMany({
        where,
        orderBy: [{ tradingDay: "desc" }, { product: "asc" }, { placeOfDelivery: "asc" }, { area: "asc" }, { firstDayDelivery: "asc" }],
        skip: query.skip,
        take: query.take
      }),
      this.prisma.gasMibgasPrice.findMany({ where: buildFilterOptionsWhere(query, "product"), distinct: ["product"], select: { product: true }, orderBy: { product: "asc" } }),
      this.prisma.gasMibgasPrice.findMany({ where: buildFilterOptionsWhere(query, "placeOfDelivery"), distinct: ["placeOfDelivery"], select: { placeOfDelivery: true }, orderBy: { placeOfDelivery: "asc" } }),
      this.prisma.gasMibgasPrice.findMany({ where: buildFilterOptionsWhere(query, "area"), distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } })
    ]);
    return {
      total,
      rows: rows.map(toPriceRow),
      filterOptions: {
        products: distinctText(products.map((row) => row.product)),
        placesOfDelivery: distinctText(places.map((row) => row.placeOfDelivery)),
        areas: distinctText(areas.map((row) => row.area))
      }
    };
  }

  async products() {
    const rows = await this.prisma.gasMibgasPrice.findMany({
      distinct: ["product", "placeOfDelivery", "area", "firstDayDelivery", "lastDayDelivery"],
      select: {
        product: true,
        placeOfDelivery: true,
        area: true,
        firstDayDelivery: true,
        lastDayDelivery: true,
        deliveryPeriodLabel: true
      },
      orderBy: [{ product: "asc" }, { placeOfDelivery: "asc" }, { area: "asc" }, { firstDayDelivery: "asc" }]
    });
    return rows.map((row) => ({
      product: row.product,
      placeOfDelivery: row.placeOfDelivery,
      area: row.area,
      firstDayDelivery: dateKey(row.firstDayDelivery),
      lastDayDelivery: dateKey(row.lastDayDelivery),
      deliveryPeriodLabel: row.deliveryPeriodLabel
    }));
  }

  async history(query: { product: string; placeOfDelivery?: string; area?: string; firstDayDelivery?: string; lastDayDelivery?: string }) {
    const product = query.product?.trim();
    if (!product) {
      throw new BadRequestException("Producto MIBGAS obligatorio.");
    }
    const rows = await this.prisma.gasMibgasPrice.findMany({
      where: {
        product: { equals: product, mode: "insensitive" },
        placeOfDelivery: query.placeOfDelivery ? { equals: query.placeOfDelivery, mode: "insensitive" } : undefined,
        area: query.area ? { equals: query.area, mode: "insensitive" } : undefined,
        firstDayDelivery: query.firstDayDelivery ? parseDate(query.firstDayDelivery) : undefined,
        lastDayDelivery: query.lastDayDelivery ? parseDate(query.lastDayDelivery) : undefined
      },
      orderBy: { tradingDay: "asc" }
    });
    return {
      product,
      rows: rows.map(toPriceRow)
    };
  }

  async status() {
    const [latestRun, latestSuccess, totalRows, latestTradingDay, nullPrices] = await Promise.all([
      this.prisma.gasMibgasSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      this.prisma.gasMibgasSyncRun.findFirst({ where: { status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
      this.prisma.gasMibgasPrice.count(),
      this.prisma.gasMibgasPrice.findFirst({ orderBy: { tradingDay: "desc" }, select: { tradingDay: true } }),
      this.prisma.gasMibgasPrice.count({ where: { priceEurMwh: null } })
    ]);
    return {
      latestRun: latestRun ? toSyncRunRow(latestRun) : null,
      latestSuccess: latestSuccess ? toSyncRunRow(latestSuccess) : null,
      totalRows,
      latestTradingDay: latestTradingDay ? dateKey(latestTradingDay.tradingDay) : null,
      nullPrices
    };
  }

  async listSyncRuns(query: { skip?: number; take?: number } = {}) {
    const take = parseBoundedInteger(query.take, 100, 1, 1000);
    const skip = parseBoundedInteger(query.skip, 0, 0, 1_000_000);
    const [total, rows] = await Promise.all([
      this.prisma.gasMibgasSyncRun.count(),
      this.prisma.gasMibgasSyncRun.findMany({ orderBy: { startedAt: "desc" }, skip, take })
    ]);
    return { total, rows: rows.map(toSyncRunRow) };
  }

  async getAutomationConfig() {
    return toAutomationConfig(await this.getOrCreateAutomationConfig());
  }

  async saveAutomationConfig(input: { active?: boolean; scheduleTime?: string; syncCurrentYear?: boolean }) {
    const current = await this.getOrCreateAutomationConfig();
    const updated = await this.prisma.gasMibgasAutomationConfig.update({
      where: { id: current.id },
      data: {
        active: typeof input.active === "boolean" ? input.active : undefined,
        scheduleTime: input.scheduleTime === undefined ? undefined : normalizeScheduleTime(input.scheduleTime),
        syncCurrentYear: typeof input.syncCurrentYear === "boolean" ? input.syncCurrentYear : undefined
      }
    });
    return toAutomationConfig(updated);
  }

  async executeAutomation(scheduleTime = DEFAULT_SCHEDULE_TIME) {
    const year = madridYear(new Date());
    const result = await this.syncYear(year, "AUTO");
    return { scheduleTime: normalizeScheduleTime(scheduleTime), year, result };
  }

  async markAutomationRun(runKey: string) {
    await this.prisma.gasMibgasAutomationConfig.update({
      where: { id: 1 },
      data: { lastRunKey: runKey, lastRunAt: new Date() }
    });
  }

  async validateDownloadNaturalKey(year: number) {
    const download: GasMibgasDownloadResult = await this.downloader.downloadYear(normalizeYear(year));
    const parsed = this.parser.parse(download.content, { year, filename: download.filename });
    const validation = validateMibgasNaturalKey(parsed.rows);
    return {
      year,
      url: download.url,
      filename: download.filename,
      rows: validation.totalRows,
      duplicateRows: validation.duplicateRows,
      duplicates: validation.duplicates.slice(0, 20).map((row) => ({
        tradingDay: dateKey(row.tradingDay),
        product: row.product,
        placeOfDelivery: row.placeOfDelivery,
        area: row.area,
        firstDayDelivery: dateKey(row.firstDayDelivery),
        lastDayDelivery: dateKey(row.lastDayDelivery)
      }))
    };
  }

  private async persistRows(tx: Prisma.TransactionClient, rows: ParsedGasMibgasRow[]) {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const row of rows) {
      const where = naturalWhere(row);
      const existing = await tx.gasMibgasPrice.findFirst({ where, select: { id: true, priceEurMwh: true } });
      if (!existing) {
        await tx.gasMibgasPrice.create({ data: toCreateData(row) });
        inserted += 1;
        continue;
      }
      if (sameDecimal(existing.priceEurMwh, row.priceEurMwh)) {
        unchanged += 1;
        continue;
      }
      await tx.gasMibgasPrice.update({
        where: { id: existing.id },
        data: toUpdateData(row)
      });
      updated += 1;
    }

    return { inserted, updated, unchanged };
  }

  private async getOrCreateAutomationConfig() {
    return this.prisma.gasMibgasAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: false,
        scheduleTime: DEFAULT_SCHEDULE_TIME,
        syncCurrentYear: true
      },
      update: {}
    });
  }
}

export function defaultGasMibgasQuery(input: Partial<Record<string, unknown>>): GasMibgasQuery {
  return {
    tradingDayFrom: stringValue(input.tradingDayFrom),
    tradingDayTo: stringValue(input.tradingDayTo),
    deliveryFrom: stringValue(input.deliveryFrom),
    deliveryTo: stringValue(input.deliveryTo),
    product: stringArrayValue(input.product),
    placeOfDelivery: stringArrayValue(input.placeOfDelivery),
    area: stringArrayValue(input.area),
    skip: parseBoundedInteger(input.skip, 0, 0, 1_000_000),
    take: parseBoundedInteger(input.take, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  };
}

function buildWhere(query: GasMibgasQuery): Prisma.GasMibgasPriceWhereInput {
  return {
    tradingDay: dateRange(query.tradingDayFrom, query.tradingDayTo),
    firstDayDelivery: dateRange(query.deliveryFrom, undefined),
    lastDayDelivery: dateRange(undefined, query.deliveryTo),
    product: inValues(query.product),
    placeOfDelivery: inValues(query.placeOfDelivery),
    area: inValues(query.area)
  };
}

function buildFilterOptionsWhere(query: GasMibgasQuery, excludedFilter: "product" | "placeOfDelivery" | "area"): Prisma.GasMibgasPriceWhereInput {
  return {
    tradingDay: dateRange(query.tradingDayFrom, query.tradingDayTo),
    firstDayDelivery: dateRange(query.deliveryFrom, undefined),
    lastDayDelivery: dateRange(undefined, query.deliveryTo),
    product: excludedFilter === "product" ? undefined : inValues(query.product),
    placeOfDelivery: excludedFilter === "placeOfDelivery" ? undefined : inValues(query.placeOfDelivery),
    area: excludedFilter === "area" ? undefined : inValues(query.area)
  };
}

function naturalWhere(row: ParsedGasMibgasRow): Prisma.GasMibgasPriceWhereInput {
  return {
    tradingDay: row.tradingDay,
    product: row.product,
    placeOfDelivery: row.placeOfDelivery,
    area: row.area,
    firstDayDelivery: row.firstDayDelivery,
    lastDayDelivery: row.lastDayDelivery
  };
}

function toCreateData(row: ParsedGasMibgasRow): Prisma.GasMibgasPriceCreateInput {
  return {
    tradingDay: row.tradingDay,
    product: row.product,
    placeOfDelivery: row.placeOfDelivery,
    area: row.area,
    firstDayDelivery: row.firstDayDelivery,
    lastDayDelivery: row.lastDayDelivery,
    priceEurMwh: row.priceEurMwh === null ? null : new Prisma.Decimal(row.priceEurMwh),
    sourceYear: row.sourceYear,
    sourceFilename: row.sourceFilename,
    sourceEmissionDatetime: row.sourceEmissionDatetime,
    deliveryPeriodLabel: row.deliveryPeriodLabel,
    rawPayloadJson: row.rawPayloadJson as Prisma.InputJsonObject
  };
}

function toUpdateData(row: ParsedGasMibgasRow): Prisma.GasMibgasPriceUpdateInput {
  return {
    priceEurMwh: row.priceEurMwh === null ? null : new Prisma.Decimal(row.priceEurMwh),
    sourceYear: row.sourceYear,
    sourceFilename: row.sourceFilename,
    sourceEmissionDatetime: row.sourceEmissionDatetime,
    deliveryPeriodLabel: row.deliveryPeriodLabel,
    rawPayloadJson: row.rawPayloadJson as Prisma.InputJsonObject
  };
}

function toPriceRow(row: {
  id: string;
  tradingDay: Date;
  product: string;
  placeOfDelivery: string;
  area: string;
  firstDayDelivery: Date;
  lastDayDelivery: Date;
  priceEurMwh: Prisma.Decimal | null;
  sourceYear: number;
  sourceFilename: string;
  sourceEmissionDatetime: Date | null;
  deliveryPeriodLabel: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    tradingDay: dateKey(row.tradingDay),
    product: row.product,
    placeOfDelivery: row.placeOfDelivery,
    area: row.area,
    firstDayDelivery: dateKey(row.firstDayDelivery),
    lastDayDelivery: dateKey(row.lastDayDelivery),
    deliveryPeriodLabel: row.deliveryPeriodLabel,
    priceEurMwh: decimalToNumber(row.priceEurMwh),
    sourceYear: row.sourceYear,
    sourceFilename: row.sourceFilename,
    sourceEmissionDatetime: row.sourceEmissionDatetime?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString()
  };
}

function toSyncResponse(row: {
  id: string;
  year: number;
  runType: string;
  status: string;
  url: string | null;
  sourceFilename: string | null;
  sourceEmissionDatetime: Date | null;
  rowsRead: number;
  insertedRows: number;
  updatedRows: number;
  unchangedRows: number;
  nullPriceRows: number;
  errorMessage: string | null;
}, errors: Array<{ row: number; message: string }>): GasMibgasSyncResponse {
  return {
    runId: row.id,
    year: row.year,
    runType: row.runType as GasMibgasSyncRunType,
    status: row.status as GasMibgasSyncResponse["status"],
    url: row.url,
    sourceFilename: row.sourceFilename,
    sourceEmissionDatetime: row.sourceEmissionDatetime?.toISOString() ?? null,
    rowsRead: row.rowsRead,
    inserted: row.insertedRows,
    updated: row.updatedRows,
    unchanged: row.unchangedRows,
    nullPrices: row.nullPriceRows,
    errors,
    errorMessage: row.errorMessage
  };
}

function toSyncRunRow(row: {
  id: string;
  year: number;
  runType: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  url: string | null;
  sourceFilename: string | null;
  sourceEmissionDatetime: Date | null;
  rowsRead: number;
  insertedRows: number;
  updatedRows: number;
  unchangedRows: number;
  nullPriceRows: number;
  errorRows: number;
  errorMessage: string | null;
}) {
  return {
    id: row.id,
    year: row.year,
    runType: row.runType,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    url: row.url,
    sourceFilename: row.sourceFilename,
    sourceEmissionDatetime: row.sourceEmissionDatetime?.toISOString() ?? null,
    rowsRead: row.rowsRead,
    insertedRows: row.insertedRows,
    updatedRows: row.updatedRows,
    unchangedRows: row.unchangedRows,
    nullPriceRows: row.nullPriceRows,
    errorRows: row.errorRows,
    errorMessage: row.errorMessage
  };
}

function toAutomationConfig(config: { active: boolean; scheduleTime: string; syncCurrentYear: boolean; lastRunKey: string | null; lastRunAt: Date | null }) {
  return {
    active: config.active,
    scheduleTime: normalizeScheduleTime(config.scheduleTime),
    syncCurrentYear: config.syncCurrentYear,
    lastRunKey: config.lastRunKey,
    lastRunAt: config.lastRunAt ? formatMadridDateTime(config.lastRunAt) : null,
    lastRunAtUtc: config.lastRunAt?.toISOString() ?? null
  };
}

function sameDecimal(left: Prisma.Decimal | null, right: string | null) {
  if (left === null || left === undefined) {
    return right === null;
  }
  return right !== null && new Prisma.Decimal(right).equals(left);
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value.toString());
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("Fecha no valida.");
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function dateRange(from?: string, to?: string) {
  if (!from && !to) {
    return undefined;
  }
  return {
    gte: from ? parseDate(from) : undefined,
    lte: to ? parseDate(to) : undefined
  };
}

function inValues(values: string[] | undefined) {
  return values?.length ? { in: values, mode: "insensitive" as const } : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown) {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const values = source.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function distinctText(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "es", { numeric: true, sensitivity: "base" }));
}

function normalizeYear(year: number) {
  const parsed = Number(year);
  if (!Number.isSafeInteger(parsed) || parsed < 2015 || parsed > 2100) {
    throw new BadRequestException("El ano MIBGAS debe estar entre 2015 y 2100.");
  }
  return parsed;
}

function normalizeScheduleTime(value: string) {
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    throw new BadRequestException("La hora debe tener formato HH:mm.");
  }
  const [hour, minute] = trimmed.split(":").map(Number);
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new BadRequestException("La hora configurada no es valida.");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function madridYear(date: Date) {
  const value = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric" }).format(date);
  return Number(value);
}

function formatMadridDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
