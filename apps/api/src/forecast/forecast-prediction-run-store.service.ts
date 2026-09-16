import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type ForecastPredictionRunListItem = {
  id: string;
  modeloId: string;
  fechaEjecucion: string;
  fechaDesde: string;
  fechaHasta: string;
  tipoPrediccion: string;
  input: unknown;
  output: unknown;
  usuario: string | null;
  createdAt: string;
};

export type CreateForecastPredictionRunInput = {
  modeloId: string;
  fechaDesde: string;
  fechaHasta: string;
  tipoPrediccion: "daily" | "range";
  input: unknown;
  output: unknown;
  usuario?: string;
};

export type ForecastPredictionRunFilters = {
  modeloId?: string;
  fechaDesde?: string;
  fechaHasta?: string;
};

@Injectable()
export class ForecastPredictionRunStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateForecastPredictionRunInput): Promise<ForecastPredictionRunListItem> {
    const row = await this.prisma.forecastPredictionRun.create({
      data: {
        modeloId: input.modeloId,
        fechaDesde: parseDate(input.fechaDesde),
        fechaHasta: parseDate(input.fechaHasta),
        tipoPrediccion: input.tipoPrediccion,
        input: input.input as Prisma.InputJsonValue,
        output: input.output as Prisma.InputJsonValue,
        usuario: input.usuario
      }
    });
    return serializeRun(row);
  }

  async list(filters: ForecastPredictionRunFilters): Promise<ForecastPredictionRunListItem[]> {
    const where: Prisma.ForecastPredictionRunWhereInput = {
      ...(filters.modeloId ? { modeloId: filters.modeloId } : {}),
      ...(filters.fechaDesde ? { fechaHasta: { gte: parseDate(filters.fechaDesde) } } : {}),
      ...(filters.fechaHasta ? { fechaDesde: { lte: parseDate(filters.fechaHasta) } } : {})
    };
    const rows = await this.prisma.forecastPredictionRun.findMany({
      where,
      orderBy: { fechaEjecucion: "desc" },
      take: 200
    });
    return rows.map(serializeRun);
  }

  async delete(id: string) {
    try {
      const row = await this.prisma.forecastPredictionRun.delete({ where: { id } });
      return serializeRun(row);
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        throw new NotFoundException("Prediccion Forecast no encontrada.");
      }
      throw error;
    }
  }
}

function isPrismaNotFoundError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function serializeRun(row: {
  id: string;
  modeloId: string;
  fechaEjecucion: Date;
  fechaDesde: Date;
  fechaHasta: Date;
  tipoPrediccion: string;
  input: Prisma.JsonValue;
  output: Prisma.JsonValue;
  usuario: string | null;
  createdAt: Date;
}): ForecastPredictionRunListItem {
  return {
    id: row.id,
    modeloId: row.modeloId,
    fechaEjecucion: row.fechaEjecucion.toISOString(),
    fechaDesde: formatDateOnly(row.fechaDesde),
    fechaHasta: formatDateOnly(row.fechaHasta),
    tipoPrediccion: row.tipoPrediccion,
    input: row.input,
    output: row.output,
    usuario: row.usuario,
    createdAt: row.createdAt.toISOString()
  };
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
