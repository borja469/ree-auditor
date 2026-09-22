import { Body, Controller, Get, Param, Post, Put, Query, Res, StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { ReeEsiosPrivateDownloadQueryDto } from "./dto/ree-esios-private-download-query.dto";
import { ReeEsiosPrivateMessagesQueryDto } from "./dto/ree-esios-private-query.dto";
import { ReeEsiosPrivateLqAutomationService, type ReeEsiosLqAutomationConfigInput } from "./ree-esios-private-lq-automation.service";
import { ReeEsiosPrivateLqService } from "./ree-esios-private-lq.service";
import { ReeEsiosPrivateService } from "./ree-esios-private.service";

@Controller("ree-esios-private")
export class ReeEsiosPrivateController {
  constructor(
    private readonly service: ReeEsiosPrivateService,
    private readonly lqService: ReeEsiosPrivateLqService,
    private readonly lqAutomationService: ReeEsiosPrivateLqAutomationService
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

  @Get("lq/monthly-matrix")
  lqMonthlyMatrix(@Query("from") from: string, @Query("to") to: string, @Query("owner") owner?: string) {
    return this.lqService.monthlyMatrix(from, to, owner);
  }

  @Post("lq/monthly-pair/download")
  downloadLqMonthlyPair(@Body() body: {
    from?: string;
    to?: string;
    month?: string;
    settlement?: string;
    owner?: string;
    liquicomun?: boolean;
    liquiEmpresa?: boolean;
  }, @Res({ passthrough: true }) response: Response) {
    return this.lqService.downloadMonthlyPairArchive({
      from: body.from ?? "",
      to: body.to ?? "",
      month: body.month ?? "",
      settlement: body.settlement ?? "",
      owner: body.owner,
      liquicomun: body.liquicomun,
      liquiEmpresa: body.liquiEmpresa
    }).then((archive) => {
      response.setHeader("Content-Type", archive.contentType);
      response.setHeader("Content-Disposition", `attachment; filename="${archive.fileName}"`);
      response.setHeader("X-REE-LQ-Metadata", encodeURIComponent(JSON.stringify(archive.metadata)));
      return new StreamableFile(archive.buffer);
    });
  }

  @Get("lq/zip-catalog")
  lqZipCatalog(@Query("monthsBack") monthsBack?: string, @Query("owner") owner?: string, @Query("all") all?: string) {
    return this.lqService.zipCatalogMatrix(Number(monthsBack ?? 15), owner, all === "true" || all === "1");
  }

  @Post("lq/zip-catalog/sync")
  syncLqZipCatalog(@Body() body: { from?: string; to?: string; owner?: string }) {
    return this.lqService.syncZipCatalogRange(body.from ?? "", body.to ?? "", body.owner);
  }

  @Post("lq/zip-catalog/download")
  downloadLqZipCatalog(@Body() body: {
    month?: string;
    settlement?: string;
    owner?: string;
    liquicomun?: boolean;
    liquiEmpresa?: boolean;
  }, @Res({ passthrough: true }) response: Response) {
    return this.lqService.downloadCatalogMonthlyPairArchive({
      month: body.month ?? "",
      settlement: body.settlement ?? "",
      owner: body.owner,
      liquicomun: body.liquicomun,
      liquiEmpresa: body.liquiEmpresa
    }).then((archive) => {
      response.setHeader("Content-Type", archive.contentType);
      response.setHeader("Content-Disposition", `attachment; filename="${archive.fileName}"`);
      response.setHeader("X-REE-LQ-Metadata", encodeURIComponent(JSON.stringify(archive.metadata)));
      return new StreamableFile(archive.buffer);
    });
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

  @Get("lq/automation")
  lqAutomation() {
    return this.lqAutomationService.getAutomationConfig();
  }

  @Put("lq/automation")
  saveLqAutomation(@Body() body: ReeEsiosLqAutomationConfigInput) {
    return this.lqAutomationService.saveAutomationConfig(body);
  }

  @Post("lq/automation/run")
  runLqAutomation() {
    return this.lqAutomationService.runAutomation("manual");
  }

  @Get("lq/automation/runs")
  lqAutomationRuns(@Query("take") take?: string) {
    return this.lqAutomationService.listRuns(Number(take ?? 20));
  }
}
