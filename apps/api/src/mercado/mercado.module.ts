import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MercadoController } from "./mercado.controller";
import { MercadoAnalyticsService } from "./mercado-analytics.service";
import { MercadoDatasetService } from "./mercado-dataset.service";
import { MercadoDatasetValidatorService } from "./mercado-dataset-validator.service";
import { MercadoIndicatorMappingService } from "./mercado-indicator-mapping.service";

@Module({
  imports: [PrismaModule],
  controllers: [MercadoController],
  providers: [MercadoDatasetService, MercadoDatasetValidatorService, MercadoIndicatorMappingService, MercadoAnalyticsService],
  exports: [MercadoDatasetService, MercadoIndicatorMappingService]
})
export class MercadoModule {}
