import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const isProduction = process.env.NODE_ENV === "production";
  const corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN);
  if (isProduction && corsOrigin.length === 0) {
    throw new Error("CORS_ORIGIN es obligatorio en produccion.");
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: corsOrigin.length > 0 ? corsOrigin : true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  logger.log(`API listening on port ${port} in ${process.env.NODE_ENV ?? "development"} mode`);
}

void bootstrap();

function parseCorsOrigin(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
