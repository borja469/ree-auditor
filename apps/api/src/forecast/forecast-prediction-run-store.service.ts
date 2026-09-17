import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type ForecastPredictionRunStatus = "PENDIENTE_VALIDACION" | "VALIDADA" | "RECHAZADA";

export type ForecastPredictionRunListItem = {
  id: string;
  modeloId: string;
  fechaEjecucion: string;
  fechaDesde: string;
  fechaHasta: string;
  tipoPrediccion: string;
  input: unknown;
  output: unknown;
  status: ForecastPredictionRunStatus;
  isOfficial: boolean;
  validatedAt: string | null;
  validatedBy: string | null;
  validationComment: string | null;
  usuario: string | null;
  createdAt: string;
  updatedAt: string;
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
  status?: ForecastPredictionRunStatus;
  official?: boolean;
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
      ...(filters.fechaHasta ? { fechaDesde: { lte: parseDate(filters.fechaHasta) } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.official !== undefined ? { isOfficial: filters.official } : {})
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

  async validate(id: string, input: { usuario?: string; comment?: string }) {
    const current = await this.findOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.forecastPredictionRun.updateMany({
        where: {
          fechaDesde: current.fechaDesde,
          fechaHasta: current.fechaHasta,
          isOfficial: true,
          id: { not: current.id }
        },
        data: { isOfficial: false }
      });
      const row = await tx.forecastPredictionRun.update({
        where: { id },
        data: {
          status: "VALIDADA",
          isOfficial: true,
          validatedAt: new Date(),
          validatedBy: input.usuario,
          validationComment: normalizeComment(input.comment)
        }
      });
      return serializeRun(row);
    });
  }

  async reject(id: string, input: { usuario?: string; comment?: string }) {
    await this.findOrThrow(id);
    const row = await this.prisma.forecastPredictionRun.update({
      where: { id },
      data: {
        status: "RECHAZADA",
        isOfficial: false,
        validatedAt: new Date(),
        validatedBy: input.usuario,
        validationComment: normalizeComment(input.comment)
      }
    });
    return serializeRun(row);
  }

  async listOfficial(filters: Pick<ForecastPredictionRunFilters, "fechaDesde" | "fechaHasta">) {
    return this.list({ ...filters, official: true, status: "VALIDADA" });
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.forecastPredictionRun.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Prediccion Forecast no encontrada.");
    }
    return row;
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
  status?: string;
  isOfficial?: boolean;
  validatedAt?: Date | null;
  validatedBy?: string | null;
  validationComment?: string | null;
  usuario: string | null;
  createdAt: Date;
  updatedAt?: Date;
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
    status: (row.status ?? "PENDIENTE_VALIDACION") as ForecastPredictionRunStatus,
    isOfficial: row.isOfficial ?? false,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    validatedBy: row.validatedBy ?? null,
    validationComment: row.validationComment ?? null,
    usuario: row.usuario,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.updatedAt ?? row.createdAt).toISOString()
  };
}

function normalizeComment(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 2000) : null;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
