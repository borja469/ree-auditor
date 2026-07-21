import { Module } from "@nestjs/common";
import { OmieSiom2Module } from "../omie-siom2/omie-siom2.module";
import { PrismaModule } from "../prisma/prisma.module";
import { OmieReerService } from "./omie-reer.service";

@Module({
  imports: [PrismaModule, OmieSiom2Module],
  providers: [OmieReerService],
  exports: [OmieReerService]
})
export class OmieReerModule {}
