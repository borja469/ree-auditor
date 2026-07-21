import { Module } from "@nestjs/common";
import { OmieReerModule } from "../omie-reer/omie-reer.module";
import { PrismaModule } from "../prisma/prisma.module";
import { OmieAnalisisController } from "./omie-analisis.controller";
import { OmieAnalisisService } from "./omie-analisis.service";

@Module({
  imports: [PrismaModule, OmieReerModule],
  controllers: [OmieAnalisisController],
  providers: [OmieAnalisisService],
  exports: [OmieAnalisisService]
})
export class OmieAnalisisModule {}
