import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OmieDescargasService } from "./omie-descargas.service";

const SCHEDULER_INTERVAL_MS = 60_000;

@Injectable()
export class OmieDescargasSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OmieDescargasSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly omieDescargasService: OmieDescargasService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick() {
    if (this.running) {
      return;
    }

    const now = new Date();
    const madridTime = madridDateParts(now);
    this.running = true;
    try {
      const config = await this.omieDescargasService.obtenerAutomatizacion();
      const runKey = `${madridTime.date}-${madridTime.time}`;
      if (!config.active || config.lastRunKey === runKey || !config.sessions.includes(madridTime.time)) {
        return;
      }

      this.logger.log(`Iniciando automatismo OMIE ${madridTime.time}: ${config.daysBack} dias, modo forzado.`);
      const result = await this.omieDescargasService.ejecutarAutomatizacion(madridTime.time, config.daysBack);
      await this.omieDescargasService.markAutomationRun(runKey);
      this.logger.log(
        `Automatismo OMIE ${madridTime.time} finalizado: ${result.totalConsultasEjecutadas} ejecutadas, ${result.procesadas} procesadas, ${result.errores} errores.`
      );
    } catch (error) {
      this.logger.error(`Error en automatismo OMIE: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}

function madridDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`
  };
}
