import { IsEnum, Matches } from "class-validator";
import { ReeSettlementVersion } from "@prisma/client";

export class LiquidationAnalysisQueryDto {
  @IsEnum(ReeSettlementVersion)
  version: ReeSettlementVersion;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$|^\d{4}-(0[1-9]|1[0-2])-\d{2}$|^\d{4}(0[1-9]|1[0-2])\d{2}$/)
  fecha: string;
}
