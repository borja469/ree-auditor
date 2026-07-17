import { Module } from "@nestjs/common";
import { OmieAnalisisModule } from "../omie-analisis/omie-analisis.module";
import { PrismaModule } from "../prisma/prisma.module";
import { OmieGuaranteesController } from "./omie-guarantees.controller";
import { OmieGuaranteesService } from "./omie-guarantees.service";

@Module({
  imports: [PrismaModule, OmieAnalisisModule],
  controllers: [OmieGuaranteesController],
  providers: [OmieGuaranteesService]
})
export class OmieGuaranteesModule {}
