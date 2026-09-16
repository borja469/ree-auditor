import { Injectable } from "@nestjs/common";
import { ForecastEvaluationService } from "./evaluation.service";
import { LinearRegressionModel } from "./linear-regression.model";
import { PredictionModel } from "./prediction-model.interface";
import { RandomForestModel } from "./random-forest.model";

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
    { id: "randomForest", name: "Random Forest", strategy: "RandomForestModel", status: "available", description: "Bosque de arboles de regresion para capturar umbrales no lineales." },
    { id: "randomForestD1", name: "Random Forest D+1", strategy: "RandomForestModel", status: "available", description: "Bosque D+1 con solo variables disponibles antes de la prediccion de manana." },
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
    if (normalizeModelId(model) === "randomforest") {
      return new RandomForestModel(this.evaluationService);
    }
    if (normalizeModelId(model) === "randomforestd1") {
      return new RandomForestModel(this.evaluationService, "randomForestD1");
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
