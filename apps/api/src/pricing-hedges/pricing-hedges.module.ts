import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PricingHedgesController } from "./pricing-hedges.controller";
import { PricingHedgesService } from "./pricing-hedges.service";

@Module({
  imports: [PrismaModule],
  controllers: [PricingHedgesController],
  providers: [PricingHedgesService],
  exports: [PricingHedgesService]
})
export class PricingHedgesModule {}
