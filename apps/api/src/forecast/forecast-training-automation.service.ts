import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { MercadoDatasetService } from "../mercado/mercado-dataset.service";
import { PrismaService } from "../prisma/prisma.service";
import { ForecastTrainingJobService } from "./forecast-training-job.service";

const SCHEDULER_INTERVAL_MS = 60_000;
const DEFAULT_SCHEDULE_TIME = "02:00";
const DEFAULT_TRAINING_START_DATE = "2025-01-01";
const DEFAULT_MODELO = "gradientBoostingD1";
const MIN_TARGET_PRICE_HOURS = 24;

export type ForecastTrainingAutomationConfigDto = {
  active: boolean;
  scheduleTime: string;
  trainingStartDate: string;
  modelo: string;
  useActiveModelType: boolean;
  geoId: number | null;
  lastRunKey: string | null;
  lastRunAt: string | null;
  lastRunAtUtc: string | null;
  lastJobId: string | null;
  nextTrainingEndDate: string;
};

export type ForecastTrainingAutomationConfigInput = {
  active?: boolean;
  scheduleTime?: string;
  trainingStartDate?: string;
  modelo?: string;
  useActiveModelType?: boolean;
  geoId?: number | null;
};

@Injectable()
export class ForecastTrainingAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForecastTrainingAutomationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoDatasetService: MercadoDatasetService,
    private readonly trainingJobService: ForecastTrainingJobService
  ) {}

  onModuleInit() {
    if (process.env.FORECAST_TRAINING_JOB_RUNNER === "1") {
      return;
    }
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
      const config = await this.getAutomationConfig();
      const runKey = `${madridTime.date}-${madridTime.time}`;
      if (!config.active || config.lastRunKey === runKey || config.scheduleTime !== madridTime.time) {
        return;
      }

      const result = await this.runAutomation("forecast-auto");
      await this.markAutomationRun(runKey, result.id);
      this.logger.log(`Automatismo Forecast ${madridTime.time}: job=${result.id} status=${result.status}.`);
    } catch (error) {
      this.logger.error(`Error en automatismo Forecast: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async getAutomationConfig(): Promise<ForecastTrainingAutomationConfigDto> {
    const config = await this.getOrCreateAutomationConfig();
    return serializeAutomationConfig(config, buildTrainingEndDate(new Date()));
  }

  async saveAutomationConfig(input: ForecastTrainingAutomationConfigInput): Promise<ForecastTrainingAutomationConfigDto> {
    const data: {
      active?: boolean;
      scheduleTime?: string;
      trainingStartDate?: Date;
      modelo?: string;
      useActiveModelType?: boolean;
      geoId?: number | null;
    } = {};

    if (typeof input.active === "boolean") {
      data.active = input.active;
    }
    if (input.scheduleTime !== undefined) {
      data.scheduleTime = normalizeScheduleTime(input.scheduleTime);
    }
    if (input.trainingStartDate !== undefined) {
      data.trainingStartDate = parseDate(input.trainingStartDate);
    }
    if (input.modelo !== undefined) {
      data.modelo = normalizeModelo(input.modelo);
    }
    if (typeof input.useActiveModelType === "boolean") {
      data.useActiveModelType = input.useActiveModelType;
    }
    if (input.geoId !== undefined) {
      data.geoId = input.geoId == null ? null : normalizeGeoId(input.geoId);
    }

    const config = await this.prisma.forecastTrainingAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: data.active ?? false,
        scheduleTime: data.scheduleTime ?? DEFAULT_SCHEDULE_TIME,
        trainingStartDate: data.trainingStartDate ?? parseDate(DEFAULT_TRAINING_START_DATE),
        modelo: data.modelo ?? DEFAULT_MODELO,
        useActiveModelType: data.useActiveModelType ?? true,
        geoId: data.geoId
      },
      update: data
    });
    return serializeAutomationConfig(config, buildTrainingEndDate(new Date()));
  }

  async runAutomation(usuario = "forecast-auto") {
    const config = await this.getOrCreateAutomationConfig();
    const fechaHasta = buildTrainingEndDate(new Date());
    const fechaDesde = formatDateOnly(config.trainingStartDate);
    const modelo = await this.resolveModelo(config.modelo, config.useActiveModelType);
    const input = {
      fechaDesde,
      fechaHasta,
      modelo,
      geoId: config.geoId ?? undefined
    };

    if (await this.trainingJobService.hasActiveJob(modelo)) {
      return this.trainingJobService.createSkippedJob(input, `Ya existe un entrenamiento ${modelo} pendiente o en ejecucion.`, usuario);
    }

    const priceHours = await this.countTargetPriceHours(fechaHasta);
    if (priceHours < MIN_TARGET_PRICE_HOURS) {
      return this.trainingJobService.createSkippedJob(
        input,
        `Precio OMIE incompleto para ${fechaHasta}: ${priceHours}/${MIN_TARGET_PRICE_HOURS} horas.`,
        usuario
      );
    }

    return this.trainingJobService.createJob(input, usuario);
  }

  async markAutomationRun(runKey: string, jobId?: string | null) {
    await this.prisma.forecastTrainingAutomationConfig.update({
      where: { id: 1 },
      data: {
        lastRunKey: runKey,
        lastRunAt: new Date(),
        lastJobId: jobId ?? null
      }
    });
  }

  private async getOrCreateAutomationConfig() {
    return this.prisma.forecastTrainingAutomationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        active: false,
        scheduleTime: DEFAULT_SCHEDULE_TIME,
        trainingStartDate: parseDate(DEFAULT_TRAINING_START_DATE),
        modelo: DEFAULT_MODELO,
        useActiveModelType: true
      },
      update: {}
    });
  }

  private async resolveModelo(configuredModelo: string, useActiveModelType: boolean) {
    if (!useActiveModelType) {
      return normalizeModelo(configuredModelo);
    }
    const active = await this.prisma.forecastModel.findFirst({
      where: { activo: true },
      select: { tipoModelo: true }
    });
    return normalizeModelo(active?.tipoModelo ?? configuredModelo);
  }

  private async countTargetPriceHours(fecha: string) {
    const dataset = await this.mercadoDatasetService.buildHourlyDataset({ fechaDesde: fecha, fechaHasta: fecha });
    return dataset.rows.filter((row) => Number.isFinite(row.precioOmie)).length;
  }
}

function serializeAutomationConfig(
  config: {
    active: boolean;
    scheduleTime: string;
    trainingStartDate: Date;
    modelo: string;
    useActiveModelType: boolean;
    geoId: number | null;
    lastRunKey: string | null;
    lastRunAt: Date | null;
    lastJobId: string | null;
  },
  nextTrainingEndDate: string
): ForecastTrainingAutomationConfigDto {
  return {
    active: config.active,
    scheduleTime: normalizeScheduleTime(config.scheduleTime),
    trainingStartDate: formatDateOnly(config.trainingStartDate),
    modelo: config.modelo,
    useActiveModelType: config.useActiveModelType,
    geoId: config.geoId,
    lastRunKey: config.lastRunKey,
    lastRunAt: config.lastRunAt ? formatMadridDateTime(config.lastRunAt) : null,
    lastRunAtUtc: config.lastRunAt?.toISOString() ?? null,
    lastJobId: config.lastJobId,
    nextTrainingEndDate
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

function buildTrainingEndDate(now: Date) {
  const today = madridDateParts(now).date;
  const end = new Date(`${today}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function normalizeScheduleTime(value: string) {
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    throw new BadRequestException("La hora debe tener formato HH:mm.");
  }
  const [hour, minute] = trimmed.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    throw new BadRequestException("La hora configurada no es valida.");
  }
  return trimmed;
}

function normalizeModelo(value: string) {
  const modelo = value.trim();
  if (!modelo) {
    throw new BadRequestException("El modelo no puede estar vacio.");
  }
  return modelo;
}

function normalizeGeoId(value: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException("geoId debe ser un entero positivo.");
  }
  return parsed;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("La fecha debe tener formato YYYY-MM-DD.");
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatMadridDateTime(date: Date) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
