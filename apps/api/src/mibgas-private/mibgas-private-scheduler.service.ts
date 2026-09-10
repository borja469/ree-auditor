import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { MibgasPrivateService } from "./mibgas-private.service";

const SCHEDULER_INTERVAL_MS = 60_000;

@Injectable()
export class MibgasPrivateSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MibgasPrivateSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly service: MibgasPrivateService) {}

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
      const config = await this.service.getAutomationConfig();
      const runKey = `${madridTime.date}-${madridTime.time}`;
      if (!config.active || config.lastRunKey === runKey || !config.sessions.includes(madridTime.time)) {
        return;
      }

      this.logger.log(
        `Iniciando automatismo MIBGAS privado ${madridTime.time}: ${config.daysBack} dias atras, ${config.daysForward} dias vista, modo forzado.`
      );
      const result = await this.service.executeAutomation(madridTime.time, config.daysBack, config.daysForward);
      await this.service.markAutomationRun(runKey);
      this.logger.log(
        `Automatismo MIBGAS privado ${madridTime.time} finalizado: ${result.totalConsultasEjecutadas} ejecutadas, ${result.procesadas} procesadas, ${result.errores} errores.`
      );
    } catch (error) {
      this.logger.error(`Error en automatismo MIBGAS privado: ${error instanceof Error ? error.message : String(error)}`);
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
