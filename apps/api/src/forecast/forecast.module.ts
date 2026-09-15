import { Module } from "@nestjs/common";
import { MercadoModule } from "../mercado/mercado.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ForecastComparisonService } from "./forecast-comparison.service";
import { ForecastController } from "./forecast.controller";
import { ForecastModelStoreService } from "./forecast-model-store.service";
import { ForecastPredictionRunStoreService } from "./forecast-prediction-run-store.service";
import { ForecastService } from "./forecast.service";
import { ForecastPredictionService } from "./prediction.service";
import { ForecastDatasetBuilderService } from "./prediction-engine/dataset-builder.service";
import { ForecastEvaluationService } from "./prediction-engine/evaluation.service";
import { ForecastFeatureImportanceService } from "./prediction-engine/feature-importance.service";
import { ForecastModelFactory } from "./prediction-engine/model-factory";
import { ForecastTrainingService } from "./prediction-engine/training.service";
import { ForecastValidationService } from "./prediction-engine/validation.service";

@Module({
  imports: [MercadoModule, PrismaModule],
  controllers: [ForecastController],
  providers: [
    ForecastService,
    ForecastComparisonService,
    ForecastModelStoreService,
    ForecastPredictionRunStoreService,
    ForecastPredictionService,
    ForecastDatasetBuilderService,
    ForecastEvaluationService,
    ForecastFeatureImportanceService,
    ForecastModelFactory,
    ForecastTrainingService,
    ForecastValidationService
  ]
})
export class ForecastModule {}
