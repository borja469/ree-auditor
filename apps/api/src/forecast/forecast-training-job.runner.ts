import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { ForecastTrainingJobService } from "./forecast-training-job.service";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    throw new Error("Uso: node forecast-training-job.runner.js <jobId>");
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    await app.get(ForecastTrainingJobService).processJob(jobId);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const logger = new Logger("ForecastTrainingJobRunner");
  logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
