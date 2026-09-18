import { IsOptional, IsString } from "class-validator";

export class ReeEsiosPrivateDownloadQueryDto {
  @IsOptional()
  @IsString()
  version?: string;
}
