import { IsIn, IsOptional, IsString, Matches } from "class-validator";

export class ReeEsiosPrivateMessagesQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsIn(["Application", "Server"])
  intervalType?: "Application" | "Server";

  @IsOptional()
  @IsString()
  messageType?: string;

  @IsOptional()
  @IsString()
  messageIdentification?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  code?: string;
}
