import { Module } from "@nestjs/common";
import { ImportsModule } from "../imports/imports.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReeLossesModule } from "../ree-losses/ree-losses.module";
import { ReeSeieModule } from "../ree-seie/ree-seie.module";
import { ReeEsiosPrivateClientService } from "./ree-esios-private-client.service";
import { ReeEsiosPrivateController } from "./ree-esios-private.controller";
import { ReeEsiosPrivateLqAutomationService } from "./ree-esios-private-lq-automation.service";
import { ReeEsiosPrivateLqService } from "./ree-esios-private-lq.service";
import { ReeEsiosPrivateParserService } from "./ree-esios-private-parser.service";
import { ReeEsiosPrivateService } from "./ree-esios-private.service";

@Module({
  imports: [PrismaModule, ImportsModule, ReeLossesModule, ReeSeieModule],
  controllers: [ReeEsiosPrivateController],
  providers: [ReeEsiosPrivateClientService, ReeEsiosPrivateParserService, ReeEsiosPrivateService, ReeEsiosPrivateLqService, ReeEsiosPrivateLqAutomationService],
  exports: [ReeEsiosPrivateService]
})
export class ReeEsiosPrivateModule {}
