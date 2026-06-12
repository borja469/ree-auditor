import { Module } from "@nestjs/common";
import { OmieSiom2Module } from "../omie-siom2/omie-siom2.module";
import { OmiePreciosController } from "./omie-precios.controller";
import { OmiePreciosService } from "./omie-precios.service";

@Module({
  imports: [OmieSiom2Module],
  controllers: [OmiePreciosController],
  providers: [OmiePreciosService],
  exports: [OmiePreciosService]
})
export class OmiePreciosModule {}
