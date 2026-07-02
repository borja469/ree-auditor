import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthMiddleware } from "./auth/auth.middleware";
import { AuthModule } from "./auth/auth.module";
import { EsiosModule } from "./esios/esios.module";
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
    AuthModule,
    PrismaModule,
    HealthModule,
    ImportsModule,
    ReeLossesModule,
    OmieSiom2Module,
    OmieProgramasModule,
    OmiePreciosModule,
    OmieTransaccionesModule,
    OmieAnalisisModule,
    OmieDescargasModule,
    EsiosModule
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).exclude("health", "auth/login").forRoutes("*");
  }
}
