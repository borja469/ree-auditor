import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MibgasPrivateClientService } from "./mibgas-private-client.service";
import { MibgasPrivateController } from "./mibgas-private.controller";
import { MibgasPrivateSchedulerService } from "./mibgas-private-scheduler.service";
import { MibgasPrivateService } from "./mibgas-private.service";
import { MibgasPrivateSoapBuilder } from "./mibgas-private-soap.builder";

@Module({
  imports: [PrismaModule],
  controllers: [MibgasPrivateController],
  providers: [MibgasPrivateService, MibgasPrivateClientService, MibgasPrivateSoapBuilder, MibgasPrivateSchedulerService],
  exports: [MibgasPrivateService]
})
export class MibgasPrivateModule {}
