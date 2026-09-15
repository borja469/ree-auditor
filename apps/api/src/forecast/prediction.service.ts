import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PredictForecastDto } from "./dto/predict-forecast.dto";
import { PredictForecastRangeDto } from "./dto/predict-forecast-range.dto";
import { ForecastModelStoreService } from "./forecast-model-store.service";
import { ForecastPredictionRunStoreService } from "./forecast-prediction-run-store.service";
import { ForecastDatasetBuilderService } from "./prediction-engine/dataset-builder.service";
import { ForecastModelFactory } from "./prediction-engine/model-factory";

export type ForecastConfidenceInterval = null | {
  lower: number;
  upper: number;
  confidenceLevel: number;
};

const NON_PREDICTABLE_MODEL_FEATURES = ["rampaPrecioOmie"];
const MIN_REASONABLE_PRICE_EUR_MWH = -500;
const MAX_REASONABLE_PRICE_EUR_MWH = 1000;

@Injectable()
export class ForecastPredictionService {
  private readonly logger = new Logger(ForecastPredictionService.name);

  constructor(
    private readonly modelStore: ForecastModelStoreService,
    private readonly datasetBuilder: ForecastDatasetBuilderService,
    private readonly modelFactory: ForecastModelFactory,
    private readonly predictionRunStore: ForecastPredictionRunStoreService
  ) {}

  async predict(dto: PredictForecastDto, usuario?: string) {
    const storedModel = await this.modelStore.getModel(dto.modeloId);
    validatePredictableModel(storedModel.variablesUtilizadas);
    const model = await this.loadModel(storedModel.id);

    const dataset = await this.datasetBuilder.buildPredictionDataset({
      fecha: dto.fecha,
      fechaDesde: dto.fecha,
      fechaHasta: dto.fecha,
      geoId: dto.geoId,
      featureNames: storedModel.variablesUtilizadas
    });
    const predictions = await model.predict(dataset);
    validatePredictionRange(predictions);
    const precioPrevisto = round(predictions.reduce((sum, row) => sum + row.predicted, 0) / predictions.length);

    this.logger.log(`Forecast predict modelo=${storedModel.id} tipo=${storedModel.tipo} fecha=${dto.fecha} filas=${predictions.length}`);

    const output = {
      modeloId: storedModel.id,
      modelo: storedModel.tipo,
      version: storedModel.version,
      fecha: dto.fecha,
      precioPrevisto,
      intervalosConfianza: null as ForecastConfidenceInterval,
      prediccionesHorarias: predictions.map((row) => ({
        timestampUtc: row.timestampUtc,
        datetimeLocal: row.datetimeLocal,
        precioPrevisto: row.predicted
      }))
    };
    await this.predictionRunStore.create({
      modeloId: dto.modeloId,
      fechaDesde: dto.fecha,
      fechaHasta: dto.fecha,
      tipoPrediccion: "daily",
      input: dto,
      output,
      usuario
    });
    return output;
  }

  async predictRange(dto: PredictForecastRangeDto, usuario?: string) {
    if (dto.fechaDesde > dto.fechaHasta) {
      throw new BadRequestException("fechaDesde no puede ser posterior a fechaHasta.");
    }
    const storedModel = await this.modelStore.getModel(dto.modeloId);
    validatePredictableModel(storedModel.variablesUtilizadas);
    const model = await this.loadModel(storedModel.id);
    const dataset = await this.datasetBuilder.buildPredictionRangeDataset({
      fechaDesde: dto.fechaDesde,
      fechaHasta: dto.fechaHasta,
      geoId: dto.geoId,
      featureNames: storedModel.variablesUtilizadas
    });
    const predictions = await model.predict(dataset);
    validatePredictionRange(predictions);
    const grouped = groupPredictionsByDate(predictions.map((row) => ({ timestampUtc: row.timestampUtc, date: row.date, datetimeLocal: row.datetimeLocal, precioPrevisto: row.predicted })));
    const output = {
      modeloId: storedModel.id,
      modelo: storedModel.tipo,
      version: storedModel.version,
      fechaDesde: dto.fechaDesde,
      fechaHasta: dto.fechaHasta,
      intervalosConfianza: null as ForecastConfidenceInterval,
      predicciones: grouped
    };
    await this.predictionRunStore.create({
      modeloId: dto.modeloId,
      fechaDesde: dto.fechaDesde,
      fechaHasta: dto.fechaHasta,
      tipoPrediccion: "range",
      input: dto,
      output,
      usuario
    });
    this.logger.log(`Forecast predict range modelo=${storedModel.id} tipo=${storedModel.tipo} desde=${dto.fechaDesde} hasta=${dto.fechaHasta} filas=${predictions.length}`);
    return output;
  }

  private async loadModel(modeloId: string) {
    const storedModel = await this.modelStore.getModel(modeloId);
    const model = this.modelFactory.create(storedModel.tipo);
    await model.load({
      model: storedModel.tipo,
      trainedAt: storedModel.fecha,
      variables: storedModel.variablesUtilizadas,
      intercept: storedModel.intercepto,
      coefficients: storedModel.coeficientes,
      featureStats: storedModel.featureStats,
      metrics: storedModel.metricasCompletas
    });
    return model;
  }
}

function validatePredictionRange(predictions: Array<{ timestampUtc: string; predicted: number }>) {
  const invalid = predictions.filter((row) => row.predicted < MIN_REASONABLE_PRICE_EUR_MWH || row.predicted > MAX_REASONABLE_PRICE_EUR_MWH);
  if (invalid.length === 0) {
    return;
  }
  const sample = invalid
    .slice(0, 5)
    .map((row) => `${row.timestampUtc}: ${round(row.predicted)}`)
    .join("; ");
  throw new BadRequestException(
    `El modelo genera precios fuera de rango operativo (${MIN_REASONABLE_PRICE_EUR_MWH} a ${MAX_REASONABLE_PRICE_EUR_MWH} €/MWh). Entrena una nueva version con el motor actualizado. Ejemplos: ${sample}.`
  );
}

function validatePredictableModel(features: string[]) {
  const invalid = features.filter((feature) => NON_PREDICTABLE_MODEL_FEATURES.includes(feature));
  if (invalid.length > 0) {
    throw new BadRequestException(`Este modelo fue entrenado con variables no disponibles para prediccion futura (${invalid.join(", ")}). Entrena una nueva version del modelo.`);
  }
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function groupPredictionsByDate(rows: Array<{ timestampUtc: string; date?: string; datetimeLocal?: string; precioPrevisto: number }>) {
  const grouped = new Map<string, Array<{ timestampUtc: string; datetimeLocal?: string; precioPrevisto: number }>>();
  for (const row of rows) {
    const date = row.date ?? row.datetimeLocal?.slice(0, 10) ?? row.timestampUtc.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), { timestampUtc: row.timestampUtc, datetimeLocal: row.datetimeLocal, precioPrevisto: row.precioPrevisto }]);
  }
  return [...grouped.entries()].map(([fecha, prediccionesHorarias]) => ({
    fecha,
    precioMedioPrevisto: round(prediccionesHorarias.reduce((sum, row) => sum + row.precioPrevisto, 0) / prediccionesHorarias.length),
    prediccionesHorarias
  }));
}
