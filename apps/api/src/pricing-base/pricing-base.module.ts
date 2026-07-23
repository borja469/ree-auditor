import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ReeLossesModule } from "../ree-losses/ree-losses.module";
import { PricingOmieLoader } from "./omie_loader";
import { PricingBaseController } from "./pricing-base.controller";
import { PricingCalculatorManualValuesService } from "./pricing_calculator_manual_values_service";
import { MeffForwardCurveService } from "./meff_forward_curve_service";
import { PricingBaseExportService } from "./table_view_export_service";
import { PricingBaseTableService } from "./pricing_base_table_service";
import { PricingProfilesLoader } from "./profiles_loader";
import { PricingRegulatedCostsLoader } from "./regulated_costs_loader";

@Module({
  imports: [PrismaModule, ReeLossesModule],
  controllers: [PricingBaseController],
  providers: [PricingBaseTableService, PricingProfilesLoader, PricingOmieLoader, PricingRegulatedCostsLoader, MeffForwardCurveService, PricingCalculatorManualValuesService, PricingBaseExportService],
  exports: [PricingBaseTableService, PricingProfilesLoader]
})
export class PricingBaseModule {}
