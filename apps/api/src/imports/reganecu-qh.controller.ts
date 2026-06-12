import { Controller, Get, Param, Query } from "@nestjs/common";
import { SettlementQueryDto } from "./dto/settlement-query.dto";
import { ImportsService } from "./imports.service";

@Controller("reganecu-qh")
export class ReganecuQhController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  listReganecuQh(@Query() query: SettlementQueryDto) {
    return this.importsService.listReganecuQh(query);
  }

  @Get(":id")
  getReganecuQhRecord(@Param("id") id: string) {
    return this.importsService.getReganecuQhRecord(id);
  }
}
