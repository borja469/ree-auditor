import { Module } from "@nestjs/common";
import { OmiePreciosModule } from "../omie-precios/omie-precios.module";
import { OmieProgramasModule } from "../omie-programas/omie-programas.module";
import { OmieTransaccionesModule } from "../omie-transacciones/omie-transacciones.module";
import { OmieDescargasController } from "./omie-descargas.controller";
import { OmieDescargasService } from "./omie-descargas.service";

@Module({
  imports: [OmieProgramasModule, OmiePreciosModule, OmieTransaccionesModule],
  controllers: [OmieDescargasController],
  providers: [OmieDescargasService]
})
export class OmieDescargasModule {}
