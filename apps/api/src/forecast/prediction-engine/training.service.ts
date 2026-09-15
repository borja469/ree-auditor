import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ForecastModelStoreService } from "../forecast-model-store.service";
import { ForecastDatasetBuilderService } from "./dataset-builder.service";
import { ForecastFeatureImportanceService } from "./feature-importance.service";
import { ForecastModelFactory } from "./model-factory";
import { ForecastValidationService } from "./validation.service";

type TrainForecastOptions = {
  fechaDesde?: string;
  fechaHasta?: string;
  geoId?: number;
  modelo?: string;
  usuario?: string;
};

@Injectable()
export class ForecastTrainingService {
  private readonly logger = new Logger(ForecastTrainingService.name);

  constructor(
    private readonly datasetBuilder: ForecastDatasetBuilderService,
    private readonly modelFactory: ForecastModelFactory,
    private readonly modelStore: ForecastModelStoreService,
    private readonly validationService: ForecastValidationService,
    private readonly featureImportanceService: ForecastFeatureImportanceService
  ) {}

  async train(options: TrainForecastOptions) {
    const startedAt = Date.now();
    const modelId = options.modelo ?? "linear";
    try {
      const dataset = await this.datasetBuilder.buildTrainingDataset(options);
      let model;
      model = this.modelFactory.create(modelId);
      const snapshot = await model.train(dataset);
      const walkForwardMetricas = await this.validationService.walkForward(dataset, modelId);
      const featureImportance = this.featureImportanceService.calculate(dataset, snapshot.coefficients);
      const durationMs = Date.now() - startedAt;
      const storedModel = await this.modelStore.createVersion({
        nombre: buildModelName(modelId),
        tipoModelo: snapshot.model,
        fechaEntrenamiento: snapshot.trainedAt ?? new Date().toISOString(),
        fechaDesde: dataset.metadata.fechaDesde,
        fechaHasta: dataset.metadata.fechaHasta,
        variablesUtilizadas: snapshot.variables,
        variablesDescartadas: dataset.excludedFeatures,
        coeficientes: snapshot.coefficients,
        featureStats: snapshot.featureStats,
        intercepto: snapshot.intercept,
        metricas: snapshot.metrics,
        walkForwardMetricas,
        featureImportance,
        numeroRegistros: dataset.rows.length,
        duracionMs: durationMs,
        usuario: options.usuario
      });

      this.logger.log(
        `Forecast train usuario=${options.usuario ?? "unknown"} modelo=${snapshot.model} version=${storedModel.version} registros=${dataset.rows.length} descartadas=${dataset.excludedFeatures.length} duracionMs=${durationMs}`
      );

      return {
        id: storedModel.id,
        version: storedModel.version,
        activo: storedModel.activo,
        modelo: snapshot.model,
        variablesUtilizadas: snapshot.variables,
        variablesExcluidas: dataset.excludedFeatures,
        numeroObservaciones: dataset.rows.length,
        totalHorasDataset: dataset.metadata.totalRows,
        observacionesConPrecio: dataset.metadata.targetRows,
        r: snapshot.metrics.r,
        mae: snapshot.metrics.mae,
        rmse: snapshot.metrics.rmse,
        walkForwardMetricas,
        featureImportance,
        intercepto: snapshot.intercept,
        coeficientes: snapshot.coefficients,
        tiempoEntrenamientoMs: durationMs,
        fechaEntrenamiento: snapshot.trainedAt
      };
    } catch (error) {
      this.logger.error(`Forecast train error usuario=${options.usuario ?? "unknown"} modelo=${modelId}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : "No se pudo entrenar el modelo Forecast.");
    }
  }
}

function buildModelName(modelId: string) {
  return `Mercado forecast ${modelId}`;
}
