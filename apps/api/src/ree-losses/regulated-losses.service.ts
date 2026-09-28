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
  sourceId?: string | null;
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
          settlementType: true,
          settlementNumber: true,
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
    const groups = new Map<string, Map<PricingSettlementVersion, Array<{ value: number; sourceId: string }>>>();
    for (const row of lossRows) {
      if (row.tarifa !== normalizedTariff || row.perdidaFinal === null) {
        continue;
      }
      const hourKey = `${row.fecha}|${row.hora}`;
      const versions = groups.get(hourKey) ?? new Map<PricingSettlementVersion, Array<{ value: number; sourceId: string }>>();
      versions.set(row.version as PricingSettlementVersion, [...(versions.get(row.version as PricingSettlementVersion) ?? []), { value: row.perdidaFinal, sourceId: row.id }]);
      groups.set(hourKey, versions);
    }

    const result = new Map<string, RegulatedLossHourlyValue>();
    for (const [hourKey, versions] of groups.entries()) {
      const [fecha, horaText] = hourKey.split("|");
      const candidates = [...versions.entries()].map(([version, values]) => {
        const hourly = hourlyAverageFromValues(fecha, Number(horaText), "", values.map((item) => item.value));
        return {
          version,
          value: {
            value: hourly.valorPromedioHorario,
            status: hourly.status,
            sourceId: values.map((item) => item.sourceId).sort().join(",") || null
          }
        };
      });
      const latest = selectLatestAvailableVersion(candidates);
      result.set(hourKey, {
        value: latest.value?.value ?? null,
        version: latest.version,
        status: latest.value?.status ?? "missing",
        sourceId: latest.value?.sourceId ?? null
      });
    }

    return result;
  }
}

const PRISMA_PRICING_VERSIONS = [
  ReeSettlementVersion.A1,
  ReeSettlementVersion.C1,
  ReeSettlementVersion.A2,
  ReeSettlementVersion.C2,
  ReeSettlementVersion.A3,
  ReeSettlementVersion.C3,
  ReeSettlementVersion.A4,
  ReeSettlementVersion.C4,
  ReeSettlementVersion.A5,
  ReeSettlementVersion.C5
];

function dateRange(fechaInicio: string, fechaFin: string) {
  return {
    gte: new Date(`${fechaInicio}T00:00:00.000Z`),
    lte: new Date(`${fechaFin}T00:00:00.000Z`)
  };
}
