import { Module } from "@nestjs/common";
import { ReeEsiosPrivateClientService } from "./ree-esios-private-client.service";
import { ReeEsiosPrivateController } from "./ree-esios-private.controller";
import { ReeEsiosPrivateParserService } from "./ree-esios-private-parser.service";
import { ReeEsiosPrivateService } from "./ree-esios-private.service";

@Module({
  controllers: [ReeEsiosPrivateController],
  providers: [ReeEsiosPrivateClientService, ReeEsiosPrivateParserService, ReeEsiosPrivateService],
  exports: [ReeEsiosPrivateService]
})
export class ReeEsiosPrivateModule {}
