import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class MedperQueryDto {
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
  @Matches(/^[A-Z]\d+$/i)
  version?: string;

  @IsOptional()
  @IsString()
  brp?: string;

  @IsOptional()
  @IsString()
  sujeto?: string;

  @IsOptional()
  @IsString()
  tarifa?: string;

  @IsOptional()
  @IsString()
  peaje?: string;

  @IsOptional()
  @IsString()
  upr?: string;

  @IsOptional()
  @IsString()
  codigoUnidad?: string;

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
