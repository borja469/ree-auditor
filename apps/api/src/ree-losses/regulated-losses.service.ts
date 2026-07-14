import { Injectable } from "@nestjs/common";
import { Prisma, ReeSettlementVersion } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hourlyAverageFromValues } from "../pricing-base/quarter_hour_aggregator";
import { selectLatestAvailableVersion } from "../pricing-base/version_selector";
import type { PricingBaseStatus, PricingCalendarHour, PricingSettlementVersion } from "../pricing-base/pricing-base.types";
import { normalizeTarifa } from "./period-engine";
import { ReeLossesAnalyticsEngine } from "./analytics-engine.service";
import { ReeLossesRegulatoryEngine } from "./regulatory-engine.service";

export type RegulatedLossHourlyValue = {
  value: number | null;
  version: PricingSettlementVersion | null;
  status: PricingBaseStatus;
};

@Injectable()
export class RegulatedLossesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regulatoryEngine: ReeLossesRegulatoryEngine,
    private readonly analyticsEngine: ReeLossesAnalyticsEngine
  ) {}

  async loadHourlyLosses(calendar: PricingCalendarHour[], tariff: string): Promise<Map<string, RegulatedLossHourlyValue>> {
    const fechaInicio = calendar[0]?.fecha;
    const fechaFin = calendar[calendar.length - 1]?.fecha;
    const normalizedTariff = normalizeTarifa(tariff);
    if (!fechaInicio || !fechaFin || !normalizedTariff) {
      return new Map();
    }

    const [kFactors, boeLosses, context] = await Promise.all([
      this.prisma.reeKFactor.findMany({
        where: {
          fecha: dateRange(fechaInicio, fechaFin),
          version: { in: PRISMA_PRICING_VERSIONS },
          tarifa: normalizedTariff
        },
        select: {
          id: true,
          createdAt: true,
          fecha: true,
          hora: true,
          cuartohora: true,
          version: true,
          tarifa: true,
          tipoArchivo: true,
          periodo: true,
          valorK: true
        },
        orderBy: [{ fecha: "asc" }, { hora: "asc" }, { cuartohora: "asc" }, { version: "desc" }]
      }),
      this.regulatoryEngine.loadBoeLosses(),
      this.regulatoryEngine.buildPeriodContext()
    ]);

    const lossRows = this.analyticsEngine.buildRows(kFactors, boeLosses, context);
    const groups = new Map<string, Map<PricingSettlementVersion, number[]>>();
    for (const row of lossRows) {
      if (row.tarifa !== normalizedTariff || row.perdidaFinal === null) {
        continue;
      }
      const hourKey = `${row.fecha}|${row.hora}`;
      const versions = groups.get(hourKey) ?? new Map<PricingSettlementVersion, number[]>();
      versions.set(row.version as PricingSettlementVersion, [...(versions.get(row.version as PricingSettlementVersion) ?? []), row.perdidaFinal]);
      groups.set(hourKey, versions);
    }

    const result = new Map<string, RegulatedLossHourlyValue>();
    for (const [hourKey, versions] of groups.entries()) {
      const [fecha, horaText] = hourKey.split("|");
      const candidates = [...versions.entries()].map(([version, values]) => {
        const hourly = hourlyAverageFromValues(fecha, Number(horaText), "", values);
        return { version, value: { value: hourly.valorPromedioHorario, status: hourly.status } };
      });
      const latest = selectLatestAvailableVersion(candidates);
      result.set(hourKey, {
        value: latest.value?.value ?? null,
        version: latest.version,
        status: latest.value?.status ?? "missing"
      });
    }

    return result;
  }
}

const PRISMA_PRICING_VERSIONS = [
  ReeSettlementVersion.C1,
  ReeSettlementVersion.C2,
  ReeSettlementVersion.C3,
  ReeSettlementVersion.C4,
  ReeSettlementVersion.C5
];

function dateRange(fechaInicio: string, fechaFin: string) {
  return {
    gte: new Date(`${fechaInicio}T00:00:00.000Z`),
    lte: new Date(`${fechaFin}T00:00:00.000Z`)
  };
}
