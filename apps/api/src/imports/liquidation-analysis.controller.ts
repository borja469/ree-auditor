import { Controller, Get, Query } from "@nestjs/common";
import { LiquidationAnalysisQueryDto } from "./dto/liquidation-analysis-query.dto";
import { ImportsService } from "./imports.service";

@Controller("liquidation-analysis")
export class LiquidationAnalysisController {
  constructor(private readonly importsService: ImportsService) {}

  @Get("filters")
  filters() {
    return this.importsService.liquidationAnalysisFilterOptions();
  }

  @Get("report")
  report(@Query() query: LiquidationAnalysisQueryDto) {
    return this.importsService.liquidationAnalysisReport(query);
  }
}
