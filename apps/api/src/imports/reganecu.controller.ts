import { Controller, Get, Param, Query } from "@nestjs/common";
import { SettlementQueryDto } from "./dto/settlement-query.dto";
import { ImportsService } from "./imports.service";

@Controller("reganecu")
export class ReganecuController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  listReganecu(@Query() query: SettlementQueryDto) {
    return this.importsService.listReganecu(query);
  }

  @Get(":id")
  getReganecuRecord(@Param("id") id: string) {
    return this.importsService.getReganecuRecord(id);
  }
}
