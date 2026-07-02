import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EsiosApiService } from "./esios-api.service";

const SCHEDULER_INTERVAL_MS = 60_000;
const DEFAULT_SCHEDULE_TIME = "06:00";
const DEFAULT_DAYS_BACK = 7;
const DEFAULT_DAYS_FORWARD = 0;

export type EsiosSeriesAutomationConfigDto = {
  active: boolean;
  scheduleTime: string;
  daysBack: number;
  daysForward: number;
  selectedIndicatorIds: number[];
  lastRunKey: string | null;
  lastRunAt: string | null;
  lastRunAtUtc: string | null;
};

export type EsiosSeriesAutomationConfigInput = {
  active?: boolean;
  scheduleTime?: string;
  daysBack?: number;
  daysForward?: number;
  selectedIndicatorIds?: number[];
};

export type EsiosSeriesAutomationRunResponse = {
  scheduleTime: string;
  startedAt: string;
  finishedAt: string;
  force: true;
  startDate: string;
  endDate: string;
  daysBack: number;
  daysForward: number;
  totalIndicators: number;
  success: number;
  errors: number;
  downloadedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  executionTimeMs: number;
  results: Array<{
    indicatorId: number;
    status: "SUCCESS" | "ERROR";
    downloadedRecords: number;
    insertedRecords: number;
    updatedRecords: number;
    executionTimeMs: number;
    errorMessage: string | null;
  }>;
};

@Injectable()
export class EsiosSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EsiosSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly esiosApiService: EsiosApiService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick() {
    if (this.running) {
      return;
    }

    const now = new Date();
    const madridTime = madridDateParts(now);
    this.running = true;
    try {
      const config = await this.obtenerAutomatizacionSeries();
      const runKey = `${madridTime.date}-${madridTime.time}`;
      if (!config.active || config.lastRunKey === runKey || config.scheduleTime !== madridTime.time || config.selectedIndicatorIds.length === 0) {
        return;
      }

      this.logger.log(`Iniciando automatismo ESIOS Series ${madridTime.time}: ${config.selectedIndicatorIds.length} indicadores.`);
      const result = await this.ejecutarAutomatizacionSeries(config.scheduleTime);
      await this.markAutomationRun(runKey);
      this.logger.log(`Automatismo ESIOS Series finalizado: ${result.success} correctos, ${result.errors} errores.`);
    } catch (error) {
      this.logger.error(`Error en automatismo ESIOS Series: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async obtenerAutomatizacionSeries(): Promise<EsiosSeriesAutomationConfigDto> {
    const config = await this.getOrCreateAutomationConfig();
    return serializeAutomationConfig(config);
  }

  async guardarAutomatizacionSeries(input: EsiosSeriesAutomationConfigInput): Promise<EsiosSeriesAutomationConfigDto> {
    const data: {
      active?: boolean;
      scheduleTime?: string;
      daysBack?: number;
      daysForward?: number;
      selectedIndicatorIds?: Prisma.InputJsonValue;
    } = {};

    if (typeof input.active === "boolean") {
      data.active = input.active;
    }
    if (input.scheduleTime !== undefined) {
      data.scheduleTime = normalizeScheduleTime(input.scheduleTime);
    }
    if (input.daysBack !== undefined) {
      data.daysBack = normalizeDayHorizon(input.daysBack, "daysBack");
    }
    if (input.daysForward !== undefined) {
      data.daysForward = normalizeDayHorizon(input.daysForward, "daysForward");
    }
    if (input.selectedIndicatorIds !== undefined) {
      data.selectedIndicatorIds = normalizeIndicatorIds(input.selectedIndicatorIds);
    }

    const config = await this.prisma.esiosSeriesAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: data.active ?? false,
        scheduleTime: data.scheduleTime ?? DEFAULT_SCHEDULE_TIME,
        daysBack: data.daysBack ?? DEFAULT_DAYS_BACK,
        daysForward: data.daysForward ?? DEFAULT_DAYS_FORWARD,
        selectedIndicatorIds: data.selectedIndicatorIds ?? []
      },
      update: data
    });
    return serializeAutomationConfig(config);
  }

  async ejecutarAutomatizacionSeries(scheduleTime = "00:00"): Promise<EsiosSeriesAutomationRunResponse> {
    const config = await this.getOrCreateAutomationConfig();
    const selectedIndicatorIds = normalizeIndicatorIds(config.selectedIndicatorIds);
    const startedAt = new Date();
    const window = buildDownloadWindow(config.daysBack, config.daysForward, startedAt);
    const results: EsiosSeriesAutomationRunResponse["results"] = [];

    for (const indicatorId of selectedIndicatorIds) {
      try {
        const result = await this.esiosApiService.downloadIndicator(indicatorId, window.startDate, window.endDate);
        results.push({
          indicatorId,
          status: result.status,
          downloadedRecords: result.downloadedRecords,
          insertedRecords: result.insertedRecords,
          updatedRecords: result.updatedRecords,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage
        });
      } catch (error) {
        results.push({
          indicatorId,
          status: "ERROR",
          downloadedRecords: 0,
          insertedRecords: 0,
          updatedRecords: 0,
          executionTimeMs: 0,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const finishedAt = new Date();
    return {
      scheduleTime: normalizeScheduleTime(scheduleTime),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      force: true,
      startDate: window.startDate,
      endDate: window.endDate,
      daysBack: config.daysBack,
      daysForward: config.daysForward,
      totalIndicators: results.length,
      success: results.filter((item) => item.status === "SUCCESS").length,
      errors: results.filter((item) => item.status === "ERROR").length,
      downloadedRecords: sumResults(results, "downloadedRecords"),
      insertedRecords: sumResults(results, "insertedRecords"),
      updatedRecords: sumResults(results, "updatedRecords"),
      executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
      results
    };
  }

  async markAutomationRun(runKey: string) {
    await this.prisma.esiosSeriesAutomationConfig.update({
      where: { id: 1 },
      data: {
        lastRunKey: runKey,
        lastRunAt: new Date()
      }
    });
  }

  private async getOrCreateAutomationConfig() {
    return this.prisma.esiosSeriesAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: false,
        scheduleTime: DEFAULT_SCHEDULE_TIME,
        daysBack: DEFAULT_DAYS_BACK,
        daysForward: DEFAULT_DAYS_FORWARD,
        selectedIndicatorIds: []
      },
      update: {}
    });
  }
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
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`
  };
}

function buildDownloadWindow(daysBack: number, daysForward: number, now = new Date()) {
  const today = madridDateParts(now).date;
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const end = new Date(`${today}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + daysForward);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
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

function normalizeDayHorizon(value: number, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 730) {
    throw new BadRequestException(`${fieldName} debe ser un entero entre 0 y 730.`);
  }
  return parsed;
}

function normalizeIndicatorIds(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      source
        .map((item) => Number(item))
        .filter((item) => Number.isSafeInteger(item) && item > 0)
    )
  ).sort((a, b) => a - b);
}

function serializeAutomationConfig(config: {
  active: boolean;
  scheduleTime: string;
  daysBack: number;
  daysForward: number;
  selectedIndicatorIds: Prisma.JsonValue;
  lastRunKey: string | null;
  lastRunAt: Date | null;
}): EsiosSeriesAutomationConfigDto {
  return {
    active: config.active,
    scheduleTime: normalizeScheduleTime(config.scheduleTime),
    daysBack: config.daysBack,
    daysForward: config.daysForward,
    selectedIndicatorIds: normalizeIndicatorIds(config.selectedIndicatorIds),
    lastRunKey: config.lastRunKey,
    lastRunAt: config.lastRunAt ? formatMadridDateTime(config.lastRunAt) : null,
    lastRunAtUtc: config.lastRunAt?.toISOString() ?? null
  };
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

function sumResults(results: EsiosSeriesAutomationRunResponse["results"], key: "downloadedRecords" | "insertedRecords" | "updatedRecords") {
  return results.reduce((total, item) => total + item[key], 0);
}
