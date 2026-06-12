import { Module } from "@nestjs/common";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";
import { LiquidationAnalysisController } from "./liquidation-analysis.controller";
import { MedperController } from "./medper.controller";
import { ReganecuController } from "./reganecu.controller";
import { ReganecuQhController } from "./reganecu-qh.controller";
import { SettlementsController } from "./settlements.controller";

@Module({
  controllers: [
    ImportsController,
    ReganecuController,
    ReganecuQhController,
    SettlementsController,
    MedperController,
    LiquidationAnalysisController
  ],
  providers: [ImportsService]
})
export class ImportsModule {}
