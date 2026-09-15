import { IsInt, IsOptional, IsString, IsUUID, Matches, Min } from "class-validator";

export class PredictForecastRangeDto {
  @IsUUID()
  modeloId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaDesde!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaHasta!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  geoId?: number;
}
