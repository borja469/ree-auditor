import { IsOptional, IsString, IsUUID, Matches } from "class-validator";

export class ForecastPredictionsQueryDto {
  @IsOptional()
  @IsUUID()
  modeloId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaDesde?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaHasta?: string;
}
