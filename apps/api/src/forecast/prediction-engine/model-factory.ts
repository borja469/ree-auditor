import { Injectable } from "@nestjs/common";
import { ForecastEvaluationService } from "./evaluation.service";
import { LinearRegressionModel } from "./linear-regression.model";
import { PredictionModel } from "./prediction-model.interface";

export type ForecastModelDefinition = {
  id: string;
  name: string;
  strategy: string;
  status: "available" | "planned";
  description: string;
};

@Injectable()
export class ForecastModelFactory {
  private readonly definitions: ForecastModelDefinition[] = [
    { id: "linear", name: "Regresion lineal multiple", strategy: "LinearRegressionModel", status: "available", description: "Primer modelo base sin dependencias pesadas." },
    { id: "randomForest", name: "Random Forest", strategy: "PendingStrategy", status: "planned", description: "Modelo previsto para fases posteriores." },
    { id: "xgboost", name: "XGBoost", strategy: "PendingStrategy", status: "planned", description: "Modelo previsto para fases posteriores." },
    { id: "lightgbm", name: "LightGBM", strategy: "PendingStrategy", status: "planned", description: "Modelo previsto para fases posteriores." },
    { id: "catboost", name: "CatBoost", strategy: "PendingStrategy", status: "planned", description: "Modelo previsto para fases posteriores." },
    { id: "prophet", name: "Prophet", strategy: "PendingStrategy", status: "planned", description: "Modelo previsto para fases posteriores." }
  ];

  constructor(private readonly evaluationService: ForecastEvaluationService) {}

  create(model: string): PredictionModel {
    if (normalizeModelId(model) === "linear") {
      return new LinearRegressionModel(this.evaluationService);
    }
    const available = this.definitions.filter((definition) => definition.status === "available").map((definition) => definition.id).join(", ");
    throw new Error(`Modelo no disponible en esta fase. Modelos disponibles: ${available}.`);
  }

  listModels() {
    return this.definitions;
  }
}

function normalizeModelId(model: string) {
  return model.trim().toLowerCase();
}
