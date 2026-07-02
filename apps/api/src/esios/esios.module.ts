import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EsiosApiService } from "./esios-api.service";
import { EsiosProfilesService } from "./esios-profiles.service";
import { EsiosController } from "./esios.controller";
import { EsiosSchedulerService } from "./esios-scheduler.service";

@Module({
  imports: [PrismaModule],
  controllers: [EsiosController],
  providers: [EsiosApiService, EsiosSchedulerService, EsiosProfilesService],
  exports: [EsiosApiService, EsiosProfilesService]
})
export class EsiosModule {}
