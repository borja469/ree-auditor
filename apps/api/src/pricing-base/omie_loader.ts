import { OmieTipoPrecio, Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { PricingBaseStatus } from "./pricing-base.types";

export type PricingOmieHourlyValue = {
  value: number | null;
  status: PricingBaseStatus;
};

@Injectable()
export class PricingOmieLoader {
  constructor(private readonly prisma: PrismaService) {}

  async loadMercadoDiario(fechaInicio: string, fechaFin: string) {
    const rows = await this.prisma.omiePrice.findMany({
      where: {
        tipoPrecio: OmieTipoPrecio.MD,
        fechaPrograma: {
          gte: parseDate(fechaInicio),
          lte: parseDate(fechaFin)
        }
      },
      select: {
        fechaPrograma: true,
        periodo: true,
        precioEurMWh: true
      },
      orderBy: [{ fechaPrograma: "asc" }, { periodo: "asc" }]
    });

    const quarters = new Map<string, number[]>();
    for (const row of rows) {
      const date = row.fechaPrograma.toISOString().slice(0, 10);
      const hour = Math.floor((row.periodo - 1) / 4);
      const key = `${date}|${hour}`;
      const values = quarters.get(key) ?? [];
      values.push(decimalToNumber(row.precioEurMWh));
      quarters.set(key, values);
    }

    const hourly = new Map<string, PricingOmieHourlyValue>();
    for (const [key, values] of quarters.entries()) {
      const status = values.length >= 4 ? "ok" : values.length >= 3 ? "partial" : "missing";
      hourly.set(key, {
        value: values.length >= 3 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        status
      });
    }
    return hourly;
  }
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function decimalToNumber(value: Prisma.Decimal) {
  return Number(value);
}
