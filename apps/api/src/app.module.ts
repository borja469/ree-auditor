import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { ImportsModule } from "./imports/imports.module";
import { OmieAnalisisModule } from "./omie-analisis/omie-analisis.module";
import { OmieDescargasModule } from "./omie-descargas/omie-descargas.module";
import { OmiePreciosModule } from "./omie-precios/omie-precios.module";
import { OmieProgramasModule } from "./omie-programas/omie-programas.module";
import { OmieSiom2Module } from "./omie-siom2/omie-siom2.module";
import { OmieTransaccionesModule } from "./omie-transacciones/omie-transacciones.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReeLossesModule } from "./ree-losses/ree-losses.module";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    ImportsModule,
    ReeLossesModule,
    OmieSiom2Module,
    OmieProgramasModule,
    OmiePreciosModule,
    OmieTransaccionesModule,
    OmieAnalisisModule,
    OmieDescargasModule
  ]
})
export class AppModule {}
