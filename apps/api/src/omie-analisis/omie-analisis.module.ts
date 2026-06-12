import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { OmieAnalisisController } from "./omie-analisis.controller";
import { OmieAnalisisService } from "./omie-analisis.service";

@Module({
  imports: [PrismaModule],
  controllers: [OmieAnalisisController],
  providers: [OmieAnalisisService]
})
export class OmieAnalisisModule {}
