import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { parseMirContractQuery } from "./dto/mir-contract-query.dto";
import { MirService } from "./mir.service";
import { MirSyncService } from "./mir-sync.service";

@Controller("mir")
export class MirController {
  constructor(
    private readonly service: MirService,
    private readonly syncService: MirSyncService
  ) {}

  @Post("sync")
  sync() {
    return this.syncService.syncAll();
  }

  @Get("config")
  getConfig() {
    return this.service.getConfig();
  }

  @Put("config")
  saveConfig(@Body() body: unknown) {
    return this.service.saveConfig(body && typeof body === "object" ? body : {});
  }

  @Get("contracts")
  listContracts(@Query() query: Record<string, unknown>) {
    return this.service.listContracts(parseMirContractQuery(query));
  }

  @Delete("contracts")
  clearContracts() {
    return this.service.clearContracts();
  }

  @Get("contracts/:id")
  getContract(@Param("id") id: string) {
    return this.service.getContract(id);
  }
}
