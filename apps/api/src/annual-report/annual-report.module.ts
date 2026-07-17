import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AnnualReportController } from "./annual-report.controller";
import { AnnualReportService } from "./annual-report.service";

@Module({
  imports: [PrismaModule],
  controllers: [AnnualReportController],
  providers: [AnnualReportService]
})
export class AnnualReportModule {}
