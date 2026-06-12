import { Module } from "@nestjs/common";
import { OmieSiom2Module } from "../omie-siom2/omie-siom2.module";
import { OmieTransaccionesController } from "./omie-transacciones.controller";
import { OmieTransaccionesService } from "./omie-transacciones.service";

@Module({
  imports: [OmieSiom2Module],
  controllers: [OmieTransaccionesController],
  providers: [OmieTransaccionesService],
  exports: [OmieTransaccionesService]
})
export class OmieTransaccionesModule {}
