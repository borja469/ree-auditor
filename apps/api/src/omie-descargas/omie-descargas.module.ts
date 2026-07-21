import { Module } from "@nestjs/common";
import { OmiePreciosModule } from "../omie-precios/omie-precios.module";
import { OmieProgramasModule } from "../omie-programas/omie-programas.module";
import { OmieReerModule } from "../omie-reer/omie-reer.module";
import { OmieTransaccionesModule } from "../omie-transacciones/omie-transacciones.module";
import { OmieDescargasSchedulerService } from "./omie-descargas-scheduler.service";
import { OmieDescargasController } from "./omie-descargas.controller";
import { OmieDescargasService } from "./omie-descargas.service";

@Module({
  imports: [OmieProgramasModule, OmiePreciosModule, OmieTransaccionesModule, OmieReerModule],
  controllers: [OmieDescargasController],
  providers: [OmieDescargasSchedulerService, OmieDescargasService]
})
export class OmieDescargasModule {}
