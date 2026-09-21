import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ReeEsiosPrivateDownloadQueryDto } from "./dto/ree-esios-private-download-query.dto";
import { ReeEsiosPrivateMessagesQueryDto } from "./dto/ree-esios-private-query.dto";
import { ReeEsiosPrivateLqService } from "./ree-esios-private-lq.service";
import { ReeEsiosPrivateService } from "./ree-esios-private.service";

@Controller("ree-esios-private")
export class ReeEsiosPrivateController {
  constructor(
    private readonly service: ReeEsiosPrivateService,
    private readonly lqService: ReeEsiosPrivateLqService
  ) {}

  @Get("diagnostics")
  diagnostics() {
    return this.service.diagnostics();
  }

  @Get("messages")
  messages(@Query() query: ReeEsiosPrivateMessagesQueryDto) {
    return this.service.listMessages({
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      intervalType: query.intervalType,
      messageType: query.messageType,
      messageIdentification: query.messageIdentification,
      owner: query.owner,
      code: query.code
    });
  }

  @Get("messages/:id/download")
  download(@Param("id") id: string, @Query() query: ReeEsiosPrivateDownloadQueryDto) {
    return this.service.downloadMessage(id, { version: query.version });
  }

  @Post("lq/liquicomun/download")
  downloadLiquicomun(@Query("date") date: string) {
    return this.lqService.downloadLiquicomun(date);
  }

  @Get("lq/messages")
  lqMessages(@Query("date") date: string) {
    return this.lqService.listMessages(date);
  }

  @Post("lq/liqui-empresa/download")
  downloadLiquiEmpresa(@Query("date") date: string, @Query("owner") owner?: string) {
    return this.lqService.downloadLiquiEmpresa(date, owner);
  }

  @Post("lq/liquicomun/sync-range")
  syncLiquicomunRange(@Body() body: { from?: string; to?: string }) {
    return this.lqService.syncLiquicomunRange(body.from ?? "", body.to ?? "");
  }

  @Post("lq/liqui-empresa/sync-range")
  syncLiquiEmpresaRange(@Body() body: { from?: string; to?: string; owner?: string }) {
    return this.lqService.syncLiquiEmpresaRange(body.from ?? "", body.to ?? "", body.owner);
  }
}
