import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ReeLossesAnalyticsEngine } from "./analytics-engine.service";
import { ReeKFactorImporter } from "./k-factor-importer.service";
import { ReeLossesRegulatoryEngine } from "./regulatory-engine.service";
import { ReeLossesController } from "./ree-losses.controller";
import { ReeLossesService } from "./ree-losses.service";

@Module({
  imports: [PrismaModule],
  controllers: [ReeLossesController],
  providers: [ReeLossesService, ReeKFactorImporter, ReeLossesRegulatoryEngine, ReeLossesAnalyticsEngine]
})
export class ReeLossesModule {}
