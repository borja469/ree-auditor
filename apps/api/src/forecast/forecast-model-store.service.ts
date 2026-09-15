import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EvaluationMetrics, ForecastFeatureStats } from "./prediction-engine/prediction-model.interface";

export type ForecastModelListItem = {
  id: string;
  nombre: string;
  version: number;
  activo: boolean;
  fecha: string;
  tipo: string;
  metricas: EvaluationMetrics;
};

export type ForecastStoredModel = ForecastModelListItem & {
  fechaDesde: string;
  fechaHasta: string;
  variablesUtilizadas: string[];
  variablesDescartadas: Array<{ variable: string; reason: string; coveragePct: number }>;
  coeficientes: Record<string, number>;
  featureStats: ForecastFeatureStats;
  intercepto: number;
  metricasCompletas: EvaluationMetrics;
  walkForwardMetricas: EvaluationMetrics & { folds: number };
  featureImportance: Array<{ variable: string; importance: number }>;
  numeroRegistros: number;
  duracionMs: number;
  usuario: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateForecastModelInput = {
  nombre: string;
  tipoModelo: string;
  fechaEntrenamiento: string;
  fechaDesde: string;
  fechaHasta: string;
  variablesUtilizadas: string[];
  variablesDescartadas: Array<{ variable: string; reason: string; coveragePct: number }>;
  coeficientes: Record<string, number>;
  featureStats?: ForecastFeatureStats;
  intercepto: number;
  metricas: EvaluationMetrics;
  walkForwardMetricas: EvaluationMetrics & { folds: number };
  featureImportance: Array<{ variable: string; importance: number }>;
  numeroRegistros: number;
  duracionMs: number;
  usuario?: string;
};

@Injectable()
export class ForecastModelStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async listModels(): Promise<ForecastModelListItem[]> {
    const rows = await this.prisma.forecastModel.findMany({
      orderBy: [{ fechaEntrenamiento: "desc" }, { version: "desc" }]
    });
    return rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      version: row.version,
      activo: row.activo,
      fecha: row.fechaEntrenamiento.toISOString(),
      tipo: row.tipoModelo,
      metricas: parseJson<EvaluationMetrics>(row.metricas, { r: null, mae: null, rmse: null })
    }));
  }

  async getModel(id: string): Promise<ForecastStoredModel> {
    const row = await this.prisma.forecastModel.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException("Modelo Forecast no encontrado.");
    }
    return {
      id: row.id,
      nombre: row.nombre,
      version: row.version,
      activo: row.activo,
      fecha: row.fechaEntrenamiento.toISOString(),
      tipo: row.tipoModelo,
      fechaDesde: formatDateOnly(row.fechaDesde),
      fechaHasta: formatDateOnly(row.fechaHasta),
      variablesUtilizadas: parseJson<string[]>(row.variablesUtilizadas, []),
      variablesDescartadas: parseJson<Array<{ variable: string; reason: string; coveragePct: number }>>(row.variablesDescartadas, []),
      coeficientes: parseJson<Record<string, number>>(row.coeficientes, {}),
      featureStats: parseJson<ForecastFeatureStats>(row.featureStats, {}),
      intercepto: Number(row.intercepto.toString()),
      metricas: parseJson<EvaluationMetrics>(row.metricas, { r: null, mae: null, rmse: null }),
      metricasCompletas: parseJson<EvaluationMetrics>(row.metricas, { r: null, mae: null, rmse: null }),
      walkForwardMetricas: parseJson<EvaluationMetrics & { folds: number }>(row.walkForwardMetricas, { r: null, mae: null, rmse: null, folds: 0 }),
      featureImportance: parseJson<Array<{ variable: string; importance: number }>>(row.featureImportance, []),
      numeroRegistros: row.numeroRegistros,
      duracionMs: row.duracionMs,
      usuario: row.usuario,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async createVersion(input: CreateForecastModelInput): Promise<ForecastStoredModel> {
    const version = await this.nextVersion(input.tipoModelo);
    const row = await this.prisma.forecastModel.create({
      data: {
        nombre: input.nombre,
        tipoModelo: input.tipoModelo,
        version,
        activo: false,
        fechaEntrenamiento: new Date(input.fechaEntrenamiento),
        fechaDesde: parseDate(input.fechaDesde),
        fechaHasta: parseDate(input.fechaHasta),
        variablesUtilizadas: input.variablesUtilizadas as Prisma.InputJsonValue,
        variablesDescartadas: input.variablesDescartadas as Prisma.InputJsonValue,
        coeficientes: input.coeficientes as Prisma.InputJsonValue,
        featureStats: (input.featureStats ?? {}) as Prisma.InputJsonValue,
        intercepto: new Prisma.Decimal(input.intercepto),
        metricas: input.metricas as Prisma.InputJsonValue,
        walkForwardMetricas: input.walkForwardMetricas as Prisma.InputJsonValue,
        featureImportance: input.featureImportance as Prisma.InputJsonValue,
        numeroRegistros: input.numeroRegistros,
        duracionMs: input.duracionMs,
        usuario: input.usuario
      }
    });
    return this.getModel(row.id);
  }

  async activateModel(id: string): Promise<ForecastStoredModel> {
    await this.getModel(id);
    await this.prisma.$transaction([
      this.prisma.forecastModel.updateMany({ where: { activo: true }, data: { activo: false } }),
      this.prisma.forecastModel.update({ where: { id }, data: { activo: true } })
    ]);
    return this.getModel(id);
  }

  private async nextVersion(tipoModelo: string) {
    const last = await this.prisma.forecastModel.findFirst({
      where: { tipoModelo },
      orderBy: { version: "desc" },
      select: { version: true }
    });
    return (last?.version ?? 0) + 1;
  }
}

function parseJson<T>(value: Prisma.JsonValue | null | undefined, fallback: T): T {
  return value == null ? fallback : (value as T);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
