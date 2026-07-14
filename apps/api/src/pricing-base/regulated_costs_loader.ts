import { Injectable } from "@nestjs/common";
import { Prisma, ReeSettlementVersion } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hourlyAverageFromValues } from "./quarter_hour_aggregator";
import { pricingPeriodForTariff } from "./tariff_periods";
import type { PricingBaseStatus, PricingCalendarHour, PricingPeriodTariff, PricingSettlementVersion } from "./pricing-base.types";
import { isPricingSettlementVersion, selectLatestAvailableVersion } from "./version_selector";

export type PricingVersionedHourlyValue = {
  value: number | null;
  version: PricingSettlementVersion | null;
  status: PricingBaseStatus;
};

export type PricingRegulatedCosts = {
  cad: Map<string, PricingVersionedHourlyValue>;
  rad: Map<string, PricingVersionedHourlyValue>;
  perdidas: Map<string, PricingVersionedHourlyValue>;
};

@Injectable()
export class PricingRegulatedCostsLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(calendar: PricingCalendarHour[], tariff: PricingPeriodTariff): Promise<PricingRegulatedCosts> {
    const fechaInicio = calendar[0]?.fecha;
    const fechaFin = calendar[calendar.length - 1]?.fecha;
    if (!fechaInicio || !fechaFin) {
      return { cad: new Map(), rad: new Map(), perdidas: new Map() };
    }

    const [cad, rad, perdidas] = await Promise.all([
      this.loadCad(fechaInicio, fechaFin),
      this.loadRad(fechaInicio, fechaFin),
      this.loadPerdidas(calendar, tariff)
    ]);
    return { cad, rad, perdidas };
  }

  private async loadCad(fechaInicio: string, fechaFin: string) {
    const rows = await this.prisma.reganecuRecord.findMany({
      where: {
        OR: [
          { codigoPrecio: { in: ["CAD", "P_CAD"] } },
          { codigoApunte: { contains: "CAD" } }
        ],
        version: { in: PRISMA_PRICING_VERSIONS },
        AND: [
          {
            OR: [
              { fecha: dateRange(fechaInicio, fechaFin) },
              { fecha: null, fechaLiquidacion: dateRange(fechaInicio, fechaFin) }
            ]
          }
        ]
      },
      select: {
        fecha: true,
        fechaLiquidacion: true,
        hora: true,
        version: true,
        precioEurMwh: true
      },
      orderBy: [{ fechaLiquidacion: "asc" }, { hora: "asc" }, { version: "desc" }]
    });

    const groups = new Map<string, Array<{ version: PricingSettlementVersion; value: number }>>();
    for (const row of rows) {
      const fecha = toIsoDate(row.fecha ?? row.fechaLiquidacion);
      const hora = row.hora;
      const version = toPricingVersion(row.version);
      const value = decimalToNumber(row.precioEurMwh);
      if (!fecha || !hora || !version || value === null) {
        continue;
      }
      const key = `${fecha}|${hora}`;
      groups.set(key, [...(groups.get(key) ?? []), { version, value }]);
    }

    return selectLatestGroupedValues(groups, "ok");
  }

  private async loadRad(fechaInicio: string, fechaFin: string) {
    const rows = await this.prisma.reganecuQhRecord.findMany({
      where: {
        OR: [
          { codigoPrecio: { in: ["RAD3", "P_RAD3", "P_2RAD3"] } },
          { codigoApunte: { contains: "RAD3" } }
        ],
        version: { in: PRISMA_PRICING_VERSIONS },
        AND: [
          {
            OR: [
              { fecha: dateRange(fechaInicio, fechaFin) },
              { fecha: null, fechaLiquidacion: dateRange(fechaInicio, fechaFin) }
            ]
          }
        ]
      },
      select: {
        fecha: true,
        fechaLiquidacion: true,
        hora: true,
        version: true,
        precioEurMwh: true
      },
      orderBy: [{ fechaLiquidacion: "asc" }, { hora: "asc" }, { version: "desc" }]
    });

    const groups = new Map<string, Map<PricingSettlementVersion, number[]>>();
    for (const row of rows) {
      const fecha = toIsoDate(row.fecha ?? row.fechaLiquidacion);
      const hora = qhPeriodToHour(row.hora);
      const version = toPricingVersion(row.version);
      const value = decimalToNumber(row.precioEurMwh);
      if (!fecha || !hora || !version || value === null) {
        continue;
      }
      const key = `${fecha}|${hora}`;
      const versions = groups.get(key) ?? new Map<PricingSettlementVersion, number[]>();
      versions.set(version, [...(versions.get(version) ?? []), value]);
      groups.set(key, versions);
    }

    return selectLatestQuarterHourlyGroups(groups);
  }

  private async loadPerdidas(calendar: PricingCalendarHour[], tariff: PricingPeriodTariff) {
    const fechaInicio = calendar[0]?.fecha ?? "";
    const fechaFin = calendar[calendar.length - 1]?.fecha ?? "";
    const tariffCandidates = lossTariffCandidates(tariff);
    const [rows, boeLosses] = await Promise.all([
      this.prisma.reeKFactor.findMany({
        where: {
          fecha: dateRange(fechaInicio, fechaFin),
          version: { in: PRISMA_PRICING_VERSIONS },
          tarifa: { in: tariffCandidates }
        },
        select: {
          fecha: true,
          hora: true,
          cuartohora: true,
          version: true,
          periodo: true,
          valorK: true
        },
        orderBy: [{ fecha: "asc" }, { hora: "asc" }, { cuartohora: "asc" }, { version: "desc" }]
      }),
      this.prisma.perdidaBoe.findMany({
        where: {
          tarifa: { in: tariffCandidates },
          fechaInicio: { lte: new Date(`${fechaFin}T00:00:00.000Z`) },
          fechaFin: { gte: new Date(`${fechaInicio}T00:00:00.000Z`) }
        },
        select: {
          tarifa: true,
          periodo: true,
          porcentajePerdida: true,
          fechaInicio: true,
          fechaFin: true
        },
        orderBy: [{ fechaInicio: "desc" }]
      })
    ]);

    const allowedPeriodByKey = new Map(calendar.map((row) => [`${row.fecha}|${row.ordenHora}`, pricingPeriodForTariff(tariff, row)]));
    const groups = new Map<string, Map<PricingSettlementVersion, number[]>>();
    for (const row of rows) {
      const fecha = toIsoDate(row.fecha);
      const hora = row.hora;
      const version = toPricingVersion(row.version);
      const valorK = decimalToNumber(row.valorK);
      const porcentajeBoe = findBoeLossPercentage(boeLosses, tariffCandidates, row.periodo, row.fecha);
      const value = valorK !== null && porcentajeBoe !== null ? valorK * porcentajeBoe : null;
      if (!fecha || !hora || !version || value === null || allowedPeriodByKey.get(`${fecha}|${hora}`) !== row.periodo) {
        continue;
      }
      const key = `${fecha}|${hora}`;
      const versions = groups.get(key) ?? new Map<PricingSettlementVersion, number[]>();
      versions.set(version, [...(versions.get(version) ?? []), value]);
      groups.set(key, versions);
    }

    return selectLatestQuarterHourlyGroups(groups);
  }
}

const PRISMA_PRICING_VERSIONS = [
  ReeSettlementVersion.C1,
  ReeSettlementVersion.C2,
  ReeSettlementVersion.C3,
  ReeSettlementVersion.C4,
  ReeSettlementVersion.C5
];

function selectLatestGroupedValues(groups: Map<string, Array<{ version: PricingSettlementVersion; value: number }>>, okStatus: PricingBaseStatus) {
  const result = new Map<string, PricingVersionedHourlyValue>();
  for (const [key, values] of groups.entries()) {
    const latest = selectLatestAvailableVersion(values);
    result.set(key, {
      value: latest.value,
      version: latest.version,
      status: latest.value === null ? "missing" : okStatus
    });
  }
  return result;
}

function selectLatestQuarterHourlyGroups(groups: Map<string, Map<PricingSettlementVersion, number[]>>) {
  const result = new Map<string, PricingVersionedHourlyValue>();
  for (const [key, versions] of groups.entries()) {
    const [fecha, horaText] = key.split("|");
    const candidates = [...versions.entries()].map(([version, values]) => {
      const hourly = hourlyAverageFromValues(fecha, Number(horaText), "", values);
      return { version, value: { value: hourly.valorPromedioHorario, status: hourly.status } };
    });
    const latest = selectLatestAvailableVersion(candidates);
    result.set(key, {
      value: latest.value?.value ?? null,
      version: latest.version,
      status: latest.value?.status ?? "missing"
    });
  }
  return result;
}

function dateRange(fechaInicio: string, fechaFin: string) {
  return {
    gte: new Date(`${fechaInicio}T00:00:00.000Z`),
    lte: new Date(`${fechaFin}T00:00:00.000Z`)
  };
}

function toPricingVersion(value: unknown) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return isPricingSettlementVersion(text) ? text : null;
}

function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lossTariffCandidates(tariff: PricingPeriodTariff) {
  if (tariff === "6.XTD") {
    return ["6.XTD", "6.1TD"];
  }
  return [tariff];
}

function findBoeLossPercentage(
  losses: Array<{ tarifa: string; periodo: string; porcentajePerdida: Prisma.Decimal; fechaInicio: Date; fechaFin: Date }>,
  tarifas: string[],
  periodo: string,
  fecha: Date
) {
  const dateOnly = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const loss = losses.find(
    (item) =>
      tarifas.includes(item.tarifa) &&
      item.periodo === periodo &&
      normalizeDateOnly(item.fechaInicio).getTime() <= dateOnly.getTime() &&
      normalizeDateOnly(item.fechaFin).getTime() >= dateOnly.getTime()
  );
  return decimalToNumber(loss?.porcentajePerdida);
}

function normalizeDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function qhPeriodToHour(value: number | null | undefined) {
  if (!value || value < 1) {
    return null;
  }
  return Math.floor((value - 1) / 4) + 1;
}
