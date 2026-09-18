import { Controller, Get, Param, Query } from "@nestjs/common";
import { ReeEsiosPrivateDownloadQueryDto } from "./dto/ree-esios-private-download-query.dto";
import { ReeEsiosPrivateMessagesQueryDto } from "./dto/ree-esios-private-query.dto";
import { ReeEsiosPrivateService } from "./ree-esios-private.service";

@Controller("ree-esios-private")
export class ReeEsiosPrivateController {
  constructor(private readonly service: ReeEsiosPrivateService) {}

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
}
