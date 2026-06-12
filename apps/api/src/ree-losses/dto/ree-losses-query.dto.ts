import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class ReeLossesQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$|^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  mes?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  fechaInicio?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  fechaFin?: string;

  @IsOptional()
  @Matches(/^(A1|C[1-5])$/i)
  version?: string;

  @IsOptional()
  @IsString()
  tarifa?: string;

  @IsOptional()
  @Matches(/^P[1-6]$/i)
  periodo?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  skip = 0;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(5000)
  take = 1000;
}
