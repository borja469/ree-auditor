import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class ReeSeieQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$|^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  fecha?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  fechaInicio?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  fechaFin?: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsOptional()
  @IsString()
  unidad?: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @IsOptional()
  @IsString()
  sentido?: string;

  @IsOptional()
  @IsString()
  segmento?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(25)
  hora?: number;

  @IsOptional()
  @IsString()
  archivo?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsIn(["csv", "xlsx"])
  format?: "csv" | "xlsx";

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  skip = 0;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  take = 100;
}
