import { Controller, Get, Query } from "@nestjs/common";
import { SettlementQueryDto } from "./dto/settlement-query.dto";
import { ImportsService } from "./imports.service";

@Controller("settlements")
export class SettlementsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get("summary")
  summary(@Query() query: SettlementQueryDto) {
    return this.importsService.settlementSummary(query);
  }

  @Get("filters")
  filters() {
    return this.importsService.settlementFilterOptions();
  }

  @Get("hourly")
  hourly(@Query() query: SettlementQueryDto) {
    return this.importsService.settlementHourly(query);
  }

  @Get("qh")
  qh(@Query() query: SettlementQueryDto) {
    return this.importsService.settlementQh(query);
  }

  @Get("compare-versions")
  compareVersions(@Query() query: SettlementQueryDto) {
    return this.importsService.compareVersions(query);
  }
}
