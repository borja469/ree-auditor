import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { GasMibgasService } from "./gas-mibgas.service";

const SCHEDULER_INTERVAL_MS = 60_000;

@Injectable()
export class GasMibgasSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GasMibgasSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly service: GasMibgasService) {}

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
      if (!config.active || !config.syncCurrentYear || config.lastRunKey === runKey || config.scheduleTime !== madridTime.time) {
        return;
      }

      this.logger.log(`Iniciando automatismo MIBGAS ${madridTime.time}.`);
      const result = await this.service.executeAutomation(config.scheduleTime);
      await this.service.markAutomationRun(runKey);
      this.logger.log(
        `Automatismo MIBGAS finalizado: ${result.result.inserted} insertados, ${result.result.updated} actualizados, ${result.result.unchanged} sin cambios.`
      );
    } catch (error) {
      this.logger.error(`Error en automatismo MIBGAS: ${error instanceof Error ? error.message : String(error)}`);
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
