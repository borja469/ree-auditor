import { Module } from "@nestjs/common";
import { PricingMeffController } from "./pricing-meff.controller";
import { PricingMeffService } from "./pricing-meff.service";

@Module({
  controllers: [PricingMeffController],
  providers: [PricingMeffService]
})
export class PricingMeffModule {}
