import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthMiddleware } from "./auth/auth.middleware";
import { AuthModule } from "./auth/auth.module";
import { EsiosModule } from "./esios/esios.module";
import { HealthModule } from "./health/health.module";
import { ImportsModule } from "./imports/imports.module";
import { OmieAnalisisModule } from "./omie-analisis/omie-analisis.module";
import { OmieDescargasModule } from "./omie-descargas/omie-descargas.module";
import { OmieGuaranteesModule } from "./omie-guarantees/omie-guarantees.module";
import { OmiePreciosModule } from "./omie-precios/omie-precios.module";
import { OmieProgramasModule } from "./omie-programas/omie-programas.module";
import { OmieSiom2Module } from "./omie-siom2/omie-siom2.module";
import { OmieTransaccionesModule } from "./omie-transacciones/omie-transacciones.module";
import { PrismaModule } from "./prisma/prisma.module";
import { PricingBaseModule } from "./pricing-base/pricing-base.module";
import { PricingMeffModule } from "./pricing-meff/pricing-meff.module";
import { ReeLossesModule } from "./ree-losses/ree-losses.module";
import { ReeSeieModule } from "./ree-seie/ree-seie.module";

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
    OmieGuaranteesModule,
    OmieDescargasModule,
    PricingBaseModule,
    PricingMeffModule,
    EsiosModule,
    ReeSeieModule
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).exclude("health", "auth/login").forRoutes("*");
  }
}
