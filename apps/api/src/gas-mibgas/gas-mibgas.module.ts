import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { GasMibgasSchedulerService } from "./gas-mibgas-scheduler.service";
import { GasMibgasController } from "./gas-mibgas.controller";
import { GasMibgasService } from "./gas-mibgas.service";
import { MibgasDownloader } from "./mibgas-downloader";

@Module({
  imports: [PrismaModule],
  controllers: [GasMibgasController],
  providers: [GasMibgasService, GasMibgasSchedulerService, MibgasDownloader],
  exports: [GasMibgasService]
})
export class GasMibgasModule {}
