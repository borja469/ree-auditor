import { IsOptional, IsString, IsUUID, Matches } from "class-validator";

export class PredictForecastDto {
  @IsUUID()
  modeloId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha!: string;

  @IsOptional()
  geoId?: number;
}
