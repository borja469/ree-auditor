import { Controller, Get, Param, Query } from "@nestjs/common";
import { ListRecordsDto } from "./dto/list-records.dto";
import { MedperQueryDto } from "./dto/medper-query.dto";
import { ImportsService } from "./imports.service";

@Controller("medper")
export class MedperController {
  constructor(private readonly importsService: ImportsService) {}

  @Get("files")
  listFiles(@Query() query: ListRecordsDto) {
    return this.importsService.listMedperFiles(query);
  }

  @Get("summary")
  summary(@Query() query: MedperQueryDto) {
    return this.importsService.medperSummary(query);
  }

  @Get("filters")
  filters() {
    return this.importsService.medperFilterOptions();
  }

  @Get("qh")
  listMedperqh(@Query() query: MedperQueryDto) {
    return this.importsService.listMedperqh(query);
  }

  @Get("qh/:id")
  getMedperqhRecord(@Param("id") id: string) {
    return this.importsService.getMedperqhRecord(id);
  }

  @Get("curves")
  curves(@Query() query: MedperQueryDto) {
    return this.importsService.medperCurves(query);
  }

  @Get("monthly-consumption")
  monthlyConsumption() {
    return this.importsService.medperMonthlyConsumption();
  }

  @Get("losses")
  losses(@Query() query: MedperQueryDto) {
    return this.importsService.medperLosses(query);
  }

  @Get("conciliation")
  conciliation(@Query() query: MedperQueryDto) {
    return this.importsService.medperConciliation(query);
  }
}
