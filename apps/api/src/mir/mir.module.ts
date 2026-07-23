import { Module } from "@nestjs/common";
import { PricingBaseModule } from "../pricing-base/pricing-base.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReeLossesModule } from "../ree-losses/ree-losses.module";
import { MirClientService } from "./mir-client.service";
import { MirController } from "./mir.controller";
import { MirService } from "./mir.service";
import { MirSyncService } from "./mir-sync.service";
import { PortfolioForecastService } from "./portfolio-forecast.service";
import { PortfolioSalePriceService } from "./portfolio-sale-price.service";
import { PricingPortfolioController } from "./pricing-portfolio.controller";
import { MirContractRepository } from "./repositories/mir-contract.repository";

@Module({
  imports: [PrismaModule, PricingBaseModule, ReeLossesModule],
  controllers: [MirController, PricingPortfolioController],
  providers: [MirClientService, MirContractRepository, MirService, MirSyncService, PortfolioForecastService, PortfolioSalePriceService],
  exports: [MirService, MirSyncService, PortfolioForecastService, PortfolioSalePriceService]
})
export class MirModule {}
