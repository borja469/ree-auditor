import { Module } from "@nestjs/common";
import { ReeSeieController } from "./ree-seie.controller";
import { ReeSeieService } from "./ree-seie.service";

@Module({
  controllers: [ReeSeieController],
  providers: [ReeSeieService],
  exports: [ReeSeieService]
})
export class ReeSeieModule {}
