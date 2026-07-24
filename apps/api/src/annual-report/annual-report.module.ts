import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PricingHedgesModule } from "../pricing-hedges/pricing-hedges.module";
import { AnnualReportController } from "./annual-report.controller";
import { AnnualReportService } from "./annual-report.service";

@Module({
  imports: [PrismaModule, PricingHedgesModule],
  controllers: [AnnualReportController],
  providers: [AnnualReportService]
})
export class AnnualReportModule {}
