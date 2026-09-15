import { BadRequestException, Injectable } from "@nestjs/common";
import { ForecastModelStoreService, ForecastStoredModel } from "./forecast-model-store.service";

@Injectable()
export class ForecastComparisonService {
  constructor(private readonly modelStore: ForecastModelStoreService) {}

  async compare(ids: string[]) {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length < 2) {
      throw new BadRequestException("Debe indicar al menos dos modelos para comparar.");
    }
    const models = await Promise.all(uniqueIds.map((id) => this.modelStore.getModel(id)));
    const best = selectBestModel(models);

    return {
      models: models.map((model) => ({
        id: model.id,
        nombre: model.nombre,
        version: model.version,
        activo: model.activo,
        tipo: model.tipo,
        fechaEntrenamiento: model.fecha,
        metricas: model.metricasCompletas,
        walkForwardMetricas: model.walkForwardMetricas,
        variablesUtilizadas: model.variablesUtilizadas,
        variablesDescartadas: model.variablesDescartadas,
        featureImportance: model.featureImportance
      })),
      recomendacion: {
        modeloId: best?.id ?? null,
        version: best?.version ?? null,
        criterio: "Menor RMSE; en empate, menor MAE.",
        motivo: best ? `Modelo recomendado por RMSE=${best.metricasCompletas.rmse ?? "-"} y MAE=${best.metricasCompletas.mae ?? "-"}.` : "No hay metricas suficientes para recomendar un modelo."
      }
    };
  }
}

function selectBestModel(models: ForecastStoredModel[]) {
  return [...models]
    .filter((model) => typeof model.metricasCompletas.rmse === "number" || typeof model.metricasCompletas.mae === "number")
    .sort((left, right) => metricValue(left.metricasCompletas.rmse) - metricValue(right.metricasCompletas.rmse) || metricValue(left.metricasCompletas.mae) - metricValue(right.metricasCompletas.mae))[0];
}

function metricValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
