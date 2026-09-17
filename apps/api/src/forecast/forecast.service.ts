import { Injectable } from "@nestjs/common";
import { ForecastPredictionsQueryDto } from "./dto/forecast-predictions-query.dto";
import { PredictForecastDto } from "./dto/predict-forecast.dto";
import { PredictForecastRangeDto } from "./dto/predict-forecast-range.dto";
import { TrainForecastDto } from "./dto/train-forecast.dto";
import { ForecastComparisonService } from "./forecast-comparison.service";
import { ForecastModelStoreService } from "./forecast-model-store.service";
import { ForecastPredictionRunStoreService } from "./forecast-prediction-run-store.service";
import { ForecastTrainingJobService } from "./forecast-training-job.service";
import { ForecastPredictionService } from "./prediction.service";
import { ForecastModelFactory } from "./prediction-engine/model-factory";
import { ForecastTrainingService } from "./prediction-engine/training.service";

@Injectable()
export class ForecastService {
  constructor(
    private readonly modelFactory: ForecastModelFactory,
    private readonly trainingService: ForecastTrainingService,
    private readonly modelStore: ForecastModelStoreService,
    private readonly predictionService: ForecastPredictionService,
    private readonly comparisonService: ForecastComparisonService,
    private readonly predictionRunStore: ForecastPredictionRunStoreService,
    private readonly trainingJobService: ForecastTrainingJobService
  ) {}

  async getModels() {
    return {
      models: await this.modelStore.listModels(),
      registeredModels: this.modelFactory.listModels()
    };
  }

  getModel(id: string) {
    return this.modelStore.getModel(id);
  }

  activateModel(id: string) {
    return this.modelStore.activateModel(id);
  }

  compareModels(ids: string[]) {
    return this.comparisonService.compare(ids);
  }

  predict(dto: PredictForecastDto, usuario?: string) {
    return this.predictionService.predict(dto, usuario);
  }

  predictRange(dto: PredictForecastRangeDto, usuario?: string) {
    return this.predictionService.predictRange(dto, usuario);
  }

  listPredictions(filters: ForecastPredictionsQueryDto) {
    return this.predictionRunStore.list({
      modeloId: filters.modeloId,
      fechaDesde: filters.fechaDesde,
      fechaHasta: filters.fechaHasta,
      status: filters.status,
      official: parseBoolean(filters.official)
    });
  }

  deletePrediction(id: string) {
    return this.predictionRunStore.delete(id);
  }

  validatePrediction(id: string, input: { comment?: string }, usuario?: string) {
    return this.predictionRunStore.validate(id, { usuario, comment: input.comment });
  }

  rejectPrediction(id: string, input: { comment?: string }, usuario?: string) {
    return this.predictionRunStore.reject(id, { usuario, comment: input.comment });
  }

  listOfficialPredictions(filters: ForecastPredictionsQueryDto) {
    return this.predictionRunStore.listOfficial({
      fechaDesde: filters.fechaDesde,
      fechaHasta: filters.fechaHasta
    });
  }

  train(dto: TrainForecastDto, usuario?: string) {
    return this.trainingService.train({
      fechaDesde: dto.fechaDesde,
      fechaHasta: dto.fechaHasta,
      modelo: dto.modelo ?? "linear",
      geoId: dto.geoId,
      usuario
    });
  }

  createTrainingJob(dto: TrainForecastDto, usuario?: string) {
    return this.trainingJobService.createJob(dto, usuario);
  }

  listTrainingJobs(filters: { take?: number; status?: string; modelo?: string }) {
    return this.trainingJobService.listJobs(filters);
  }

  getTrainingJob(id: string) {
    return this.trainingJobService.getJob(id);
  }
}

function parseBoolean(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value === "true" || value === "1";
}
