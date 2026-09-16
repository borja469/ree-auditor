import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from "class-validator";

export class TrainForecastDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaDesde!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaHasta!: string;

  @IsOptional()
  @IsString()
  @IsIn(["linear", "randomForest", "randomForestD1", "gradientBoostingD1", "xgboost", "lightgbm", "catboost", "prophet"])
  modelo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  geoId?: number;
}
