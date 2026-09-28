import { Module } from "@nestjs/common";
import { PricingBaseModule } from "../pricing-base/pricing-base.module";
import { ReeLossesModule } from "../ree-losses/ree-losses.module";
import { BillingDashboardController } from "./billing-dashboard.controller";
import { BillingDashboardService } from "./billing-dashboard.service";
import { GisceClientService } from "./gisce-client.service";

@Module({
  imports: [PricingBaseModule, ReeLossesModule],
  controllers: [BillingDashboardController],
  providers: [BillingDashboardService, GisceClientService]
})
export class BillingDashboardModule {}
