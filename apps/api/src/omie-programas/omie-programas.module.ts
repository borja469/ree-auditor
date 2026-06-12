import { Module } from "@nestjs/common";
import { OmieSiom2Module } from "../omie-siom2/omie-siom2.module";
import { OmieProgramasController } from "./omie-programas.controller";
import { OmieProgramasService } from "./omie-programas.service";

@Module({
  imports: [OmieSiom2Module],
  controllers: [OmieProgramasController],
  providers: [OmieProgramasService],
  exports: [OmieProgramasService]
})
export class OmieProgramasModule {}
