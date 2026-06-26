import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EsiosApiService } from "./esios-api.service";

const SCHEDULER_INTERVAL_MS = 60_000;
const DAILY_HOUR = 6;
const DAILY_MINUTE = 0;

@Injectable()
export class EsiosSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EsiosSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunKey?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly esiosApiService: EsiosApiService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick() {
    const now = new Date();
    const madridTime = madridDateParts(now);
    const runKey = madridTime.date;
    if (this.running || this.lastRunKey === runKey || madridTime.hour !== DAILY_HOUR || madridTime.minute !== DAILY_MINUTE) {
      return;
    }

    this.running = true;
    try {
      const config = await this.prisma.esiosConfig.findUnique({ where: { id: 1 } });
      if (!config?.active) {
        return;
      }
      const indicators = await this.prisma.esiosIndicator.findMany({
        where: { active: true },
        select: { indicatorId: true }
      });
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 30);

      for (const indicator of indicators) {
        try {
          await this.esiosApiService.downloadIndicator(indicator.indicatorId, start.toISOString(), end.toISOString());
        } catch (error) {
          this.logger.error(`Error en descarga automatica ESIOS ${indicator.indicatorId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.lastRunKey = runKey;
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
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}
