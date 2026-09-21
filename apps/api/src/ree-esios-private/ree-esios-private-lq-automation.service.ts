import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ReeEsiosPrivateLqService } from "./ree-esios-private-lq.service";

const SCHEDULER_INTERVAL_MS = 60_000;
const DEFAULT_SCHEDULE_TIME = "06:30";
const DEFAULT_DAYS_BACK = 7;
const DEFAULT_OWNER = "STROM";

type LqAutomationRunTrigger = "manual" | "scheduled";

export type ReeEsiosLqAutomationConfigDto = {
  active: boolean;
  scheduleTime: string;
  daysBack: number;
  owner: string;
  syncLiquiEmpresa: boolean;
  syncLiquicomun: boolean;
  lastRunKey: string | null;
  lastRunAt: string | null;
  lastRunAtUtc: string | null;
};

export type ReeEsiosLqAutomationConfigInput = {
  active?: boolean;
  scheduleTime?: string;
  daysBack?: number;
  owner?: string;
  syncLiquiEmpresa?: boolean;
  syncLiquicomun?: boolean;
};

export type ReeEsiosLqAutomationRunResponse = {
  id: string;
  trigger: LqAutomationRunTrigger;
  status: "SUCCESS" | "ERROR";
  startedAt: string;
  finishedAt: string;
  executionTimeMs: number;
  publicationFrom: string;
  publicationTo: string;
  daysBack: number;
  owner: string;
  syncLiquiEmpresa: boolean;
  syncLiquicomun: boolean;
  totalPublications: number;
  importedFiles: number;
  skippedFiles: number;
  failedItems: number;
  errorMessage: string | null;
  results: Array<{
    family: "liquicomun" | "liqui-empresa";
    requestedPublicationDate: string;
    messageId: string;
    code: string;
    messageDate: string | null;
    totalFiles: number;
    selectedFiles: number;
    importedFiles: number;
    skippedFiles: number;
    failedFiles: number;
  }>;
};

@Injectable()
export class ReeEsiosPrivateLqAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReeEsiosPrivateLqAutomationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lqService: ReeEsiosPrivateLqService
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

    const madridTime = madridDateParts(new Date());
    this.running = true;
    try {
      const config = await this.getAutomationConfig();
      const runKey = `${madridTime.date}-${madridTime.time}`;
      if (!config.active || config.lastRunKey === runKey || config.scheduleTime !== madridTime.time) {
        return;
      }

      this.logger.log(`Iniciando automatismo REE/eSIOS LQ ${madridTime.time}: ultimos ${config.daysBack} dias.`);
      const result = await this.runAutomation("scheduled");
      await this.markAutomationRun(runKey);
      this.logger.log(`Automatismo REE/eSIOS LQ finalizado: ${result.totalPublications} publicaciones, ${result.failedItems} errores.`);
    } catch (error) {
      this.logger.error(`Error en automatismo REE/eSIOS LQ: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async getAutomationConfig(): Promise<ReeEsiosLqAutomationConfigDto> {
    const config = await this.getOrCreateAutomationConfig();
    return serializeConfig(config);
  }

  async saveAutomationConfig(input: ReeEsiosLqAutomationConfigInput): Promise<ReeEsiosLqAutomationConfigDto> {
    const data: {
      active?: boolean;
      scheduleTime?: string;
      daysBack?: number;
      owner?: string;
      syncLiquiEmpresa?: boolean;
      syncLiquicomun?: boolean;
    } = {};

    if (typeof input.active === "boolean") {
      data.active = input.active;
    }
    if (input.scheduleTime !== undefined) {
      data.scheduleTime = normalizeScheduleTime(input.scheduleTime);
    }
    if (input.daysBack !== undefined) {
      data.daysBack = normalizeDaysBack(input.daysBack);
    }
    if (input.owner !== undefined) {
      data.owner = normalizeOwner(input.owner);
    }
    if (typeof input.syncLiquiEmpresa === "boolean") {
      data.syncLiquiEmpresa = input.syncLiquiEmpresa;
    }
    if (typeof input.syncLiquicomun === "boolean") {
      data.syncLiquicomun = input.syncLiquicomun;
    }

    const config = await this.prisma.reeEsiosLqAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: data.active ?? false,
        scheduleTime: data.scheduleTime ?? DEFAULT_SCHEDULE_TIME,
        daysBack: data.daysBack ?? DEFAULT_DAYS_BACK,
        owner: data.owner ?? DEFAULT_OWNER,
        syncLiquiEmpresa: data.syncLiquiEmpresa ?? true,
        syncLiquicomun: data.syncLiquicomun ?? true
      },
      update: data
    });
    return serializeConfig(config);
  }

  async runAutomation(trigger: LqAutomationRunTrigger = "manual"): Promise<ReeEsiosLqAutomationRunResponse> {
    const config = await this.getOrCreateAutomationConfig();
    const window = buildPublicationWindow(config.daysBack, new Date());
    const startedAt = new Date();
    const run = await this.prisma.reeEsiosLqAutomationRun.create({
      data: {
        trigger,
        status: "RUNNING",
        startedAt,
        publicationFrom: parseDate(window.from),
        publicationTo: parseDate(window.to),
        daysBack: config.daysBack,
        owner: config.owner,
        syncLiquiEmpresa: config.syncLiquiEmpresa,
        syncLiquicomun: config.syncLiquicomun
      }
    });

    try {
      const rawResults: unknown[] = [];
      if (config.syncLiquiEmpresa) {
        rawResults.push(await this.lqService.syncLiquiEmpresaRange(window.from, window.to, config.owner));
      }
      if (config.syncLiquicomun) {
        rawResults.push(await this.lqService.syncLiquicomunRange(window.from, window.to));
      }

      const compactResults = compactRunResults(rawResults);
      const summary = summarizeCompactResults(compactResults);
      const finishedAt = new Date();
      const status = summary.failedItems > 0 ? "ERROR" : "SUCCESS";
      await this.prisma.reeEsiosLqAutomationRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt,
          executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
          totalPublications: compactResults.length,
          importedFiles: summary.importedFiles,
          skippedFiles: summary.skippedFiles,
          failedItems: summary.failedItems,
          resultJson: compactResults as Prisma.InputJsonValue
        }
      });

      return {
        id: run.id,
        trigger,
        status,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
        publicationFrom: window.from,
        publicationTo: window.to,
        daysBack: config.daysBack,
        owner: config.owner,
        syncLiquiEmpresa: config.syncLiquiEmpresa,
        syncLiquicomun: config.syncLiquicomun,
        totalPublications: compactResults.length,
        importedFiles: summary.importedFiles,
        skippedFiles: summary.skippedFiles,
        failedItems: summary.failedItems,
        errorMessage: null,
        results: compactResults
      };
    } catch (error) {
      const finishedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.prisma.reeEsiosLqAutomationRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          finishedAt,
          executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
          failedItems: 1,
          errorMessage
        }
      });
      return {
        id: run.id,
        trigger,
        status: "ERROR",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        executionTimeMs: finishedAt.getTime() - startedAt.getTime(),
        publicationFrom: window.from,
        publicationTo: window.to,
        daysBack: config.daysBack,
        owner: config.owner,
        syncLiquiEmpresa: config.syncLiquiEmpresa,
        syncLiquicomun: config.syncLiquicomun,
        totalPublications: 0,
        importedFiles: 0,
        skippedFiles: 0,
        failedItems: 1,
        errorMessage,
        results: []
      };
    }
  }

  async listRuns(take = 20) {
    const limit = Math.min(Math.max(Number(take) || 20, 1), 100);
    const runs = await this.prisma.reeEsiosLqAutomationRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit
    });
    return runs.map((run) => ({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      executionTimeMs: run.executionTimeMs,
      publicationFrom: formatDateOnly(run.publicationFrom),
      publicationTo: formatDateOnly(run.publicationTo),
      daysBack: run.daysBack,
      owner: run.owner,
      syncLiquiEmpresa: run.syncLiquiEmpresa,
      syncLiquicomun: run.syncLiquicomun,
      totalPublications: run.totalPublications,
      importedFiles: run.importedFiles,
      skippedFiles: run.skippedFiles,
      failedItems: run.failedItems,
      errorMessage: run.errorMessage
    }));
  }

  async markAutomationRun(runKey: string) {
    await this.prisma.reeEsiosLqAutomationConfig.update({
      where: { id: 1 },
      data: {
        lastRunKey: runKey,
        lastRunAt: new Date()
      }
    });
  }

  private async getOrCreateAutomationConfig() {
    return this.prisma.reeEsiosLqAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: false,
        scheduleTime: DEFAULT_SCHEDULE_TIME,
        daysBack: DEFAULT_DAYS_BACK,
        owner: DEFAULT_OWNER,
        syncLiquiEmpresa: true,
        syncLiquicomun: true
      },
      update: {}
    });
  }
}

function compactRunResults(rawResults: unknown[]) {
  const compact: ReeEsiosLqAutomationRunResponse["results"] = [];
  for (const raw of rawResults) {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { results?: unknown }).results)) {
      continue;
    }
    for (const item of (raw as { results: unknown[] }).results) {
      if (!item || typeof item !== "object" || !("family" in item)) {
        continue;
      }
      const result = item as {
        family: "liquicomun" | "liqui-empresa";
        requestedPublicationDate: string;
        selectedMessage: { messageId: string; code: string; messageDate: string | null };
        downloaded: { totalFiles: number };
        selectedFiles: Array<{ status: "IMPORTED" | "SKIPPED" | "FAILED" }>;
      };
      compact.push({
        family: result.family,
        requestedPublicationDate: result.requestedPublicationDate,
        messageId: result.selectedMessage.messageId,
        code: result.selectedMessage.code,
        messageDate: result.selectedMessage.messageDate,
        totalFiles: result.downloaded.totalFiles,
        selectedFiles: result.selectedFiles.length,
        importedFiles: result.selectedFiles.filter((file) => file.status === "IMPORTED").length,
        skippedFiles: result.selectedFiles.filter((file) => file.status === "SKIPPED").length,
        failedFiles: result.selectedFiles.filter((file) => file.status === "FAILED").length
      });
    }
  }
  return compact;
}

function summarizeCompactResults(results: ReeEsiosLqAutomationRunResponse["results"]) {
  return {
    importedFiles: results.reduce((sum, item) => sum + item.importedFiles, 0),
    skippedFiles: results.reduce((sum, item) => sum + item.skippedFiles, 0),
    failedItems: results.reduce((sum, item) => sum + item.failedFiles, 0)
  };
}

function serializeConfig(config: {
  active: boolean;
  scheduleTime: string;
  daysBack: number;
  owner: string;
  syncLiquiEmpresa: boolean;
  syncLiquicomun: boolean;
  lastRunKey: string | null;
  lastRunAt: Date | null;
}): ReeEsiosLqAutomationConfigDto {
  return {
    active: config.active,
    scheduleTime: normalizeScheduleTime(config.scheduleTime),
    daysBack: config.daysBack,
    owner: normalizeOwner(config.owner),
    syncLiquiEmpresa: config.syncLiquiEmpresa,
    syncLiquicomun: config.syncLiquicomun,
    lastRunKey: config.lastRunKey,
    lastRunAt: config.lastRunAt ? formatMadridDateTime(config.lastRunAt) : null,
    lastRunAtUtc: config.lastRunAt?.toISOString() ?? null
  };
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

function buildPublicationWindow(daysBack: number, now: Date) {
  const today = madridDateParts(now).date;
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - daysBack);
  return {
    from: start.toISOString().slice(0, 10),
    to: today
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

function normalizeDaysBack(value: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new BadRequestException("daysBack debe ser un entero entre 1 y 31.");
  }
  return parsed;
}

function normalizeOwner(value: string) {
  const owner = value.trim().toUpperCase();
  if (!owner) {
    throw new BadRequestException("owner no puede estar vacio.");
  }
  return owner.slice(0, 40);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
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
