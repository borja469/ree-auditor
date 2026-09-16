import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { spawn } from "node:child_process";
import path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { TrainForecastDto } from "./dto/train-forecast.dto";
import { ForecastTrainingService } from "./prediction-engine/training.service";

type ForecastTrainingJobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "ERROR";

@Injectable()
export class ForecastTrainingJobService {
  private readonly logger = new Logger(ForecastTrainingJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingService: ForecastTrainingService
  ) {}

  async createJob(input: TrainForecastDto, usuario?: string) {
    const modelo = input.modelo ?? "linear";
    const row = await this.prisma.forecastTrainingJob.create({
      data: {
        status: "PENDING",
        modelo,
        fechaDesde: parseDate(input.fechaDesde),
        fechaHasta: parseDate(input.fechaHasta),
        geoId: input.geoId,
        usuario,
        input: { ...input, modelo } as Prisma.InputJsonObject
      }
    });
    this.spawnRunner(row.id);
    return this.getJob(row.id);
  }

  async listJobs(filters: { take?: number; status?: string; modelo?: string } = {}) {
    const rows = await this.prisma.forecastTrainingJob.findMany({
      where: {
        status: filters.status,
        modelo: filters.modelo
      },
      orderBy: { createdAt: "desc" },
      take: boundedTake(filters.take)
    });
    return rows.map(toJobDto);
  }

  async getJob(id: string) {
    const row = await this.prisma.forecastTrainingJob.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Job de entrenamiento Forecast no encontrado.");
    }
    return toJobDto(row);
  }

  async processJob(id: string) {
    const started = await this.prisma.forecastTrainingJob.update({
      where: { id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        errorMessage: null
      }
    });
    this.logger.log(`Forecast training job start id=${started.id} modelo=${started.modelo}`);

    try {
      const result = await this.trainingService.train({
        fechaDesde: formatDateOnly(started.fechaDesde),
        fechaHasta: formatDateOnly(started.fechaHasta),
        geoId: started.geoId ?? undefined,
        modelo: started.modelo,
        usuario: started.usuario ?? undefined
      });
      await this.prisma.forecastTrainingJob.update({
        where: { id },
        data: {
          status: "SUCCESS",
          result: result as Prisma.InputJsonValue,
          forecastModelId: result.id,
          finishedAt: new Date()
        }
      });
      this.logger.log(`Forecast training job success id=${id} modelo=${started.modelo} forecastModelId=${result.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.forecastTrainingJob.update({
        where: { id },
        data: {
          status: "ERROR",
          errorMessage: message.slice(0, 4000),
          finishedAt: new Date()
        }
      });
      this.logger.error(`Forecast training job error id=${id} modelo=${started.modelo}: ${message}`);
    }
  }

  private spawnRunner(jobId: string) {
    const runnerPath = path.join(__dirname, "forecast-training-job.runner.js");
    const child = spawn(process.execPath, [runnerPath, jobId], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: process.env
    });
    child.unref();
    this.logger.log(`Forecast training job spawned id=${jobId} pid=${child.pid ?? "unknown"}`);
  }
}

function toJobDto(row: {
  id: string;
  status: string;
  modelo: string;
  fechaDesde: Date;
  fechaHasta: Date;
  geoId: number | null;
  usuario: string | null;
  input: Prisma.JsonValue;
  result: Prisma.JsonValue | null;
  errorMessage: string | null;
  forecastModelId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    status: row.status as ForecastTrainingJobStatus,
    modelo: row.modelo,
    fechaDesde: formatDateOnly(row.fechaDesde),
    fechaHasta: formatDateOnly(row.fechaHasta),
    geoId: row.geoId,
    usuario: row.usuario,
    input: row.input,
    result: row.result,
    errorMessage: row.errorMessage,
    forecastModelId: row.forecastModelId,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function boundedTake(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 25;
  }
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}
