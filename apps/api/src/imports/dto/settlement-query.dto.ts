import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { ReeSettlementVersion } from "@prisma/client";

export class SettlementQueryDto {
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
  @IsEnum(ReeSettlementVersion)
  version?: ReeSettlementVersion;

  @IsOptional()
  @IsString()
  brp?: string;

  @IsOptional()
  @IsString()
  sujeto?: string;

  @IsOptional()
  @IsString()
  segmento?: string;

  @IsOptional()
  @IsString()
  codigoApunte?: string;

  @IsOptional()
  @IsString()
  codigoPrecio?: string;

  @IsOptional()
  @IsString()
  eicUpr?: string;

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
