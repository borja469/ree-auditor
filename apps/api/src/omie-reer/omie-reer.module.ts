import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { OmieReerService } from "./omie-reer.service";

@Module({
  imports: [PrismaModule],
  providers: [OmieReerService],
  exports: [OmieReerService]
})
export class OmieReerModule {}
