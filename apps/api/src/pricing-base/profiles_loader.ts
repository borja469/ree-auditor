import { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildPricingCalendarRange } from "./calendar_builder";
import type { PricingProfileSource } from "./pricing-base.types";

export type PricingProfileValues = {
  profile20td: number | null;
  profile30td: number | null;
  profile30tdve: number | null;
  profile61td: number | null;
  profile20tdStatus: "ok" | "partial" | "missing";
  profile30tdStatus: "ok" | "partial" | "missing";
  profile30tdveStatus: "ok" | "partial" | "missing";
  profile61tdStatus: "ok" | "partial" | "missing";
  profile20tdSource: PricingProfileSource;
  profile30tdSource: PricingProfileSource;
  profile30tdveSource: PricingProfileSource;
  profile61tdSource: PricingProfileSource;
};

export interface ProfileStrategy {
  getHourlyWeights(fechaInicio: string, fechaFin: string): Promise<Map<string, Partial<PricingProfileValues>>>;
}

@Injectable()
export class PricingProfilesLoader {
  constructor(private readonly prisma: PrismaService) {}

  async loadProfiles(fechaInicio: string, fechaFin: string) {
    const strategies: ProfileStrategy[] = [new ReeProfileStrategy(this.prisma), new UnitProfileStrategy()];
    const result = new Map<string, PricingProfileValues>();
    for (const strategy of strategies) {
      const weights = await strategy.getHourlyWeights(fechaInicio, fechaFin);
      for (const [key, values] of weights.entries()) {
        result.set(key, { ...emptyProfileValues(), ...(result.get(key) ?? {}), ...values });
      }
    }
    return result;
  }
}

class ReeProfileStrategy implements ProfileStrategy {
  constructor(private readonly prisma: PrismaService) {}

  async getHourlyWeights(fechaInicio: string, fechaFin: string) {
    const monthStart = startOfMonth(parseDate(fechaInicio));
    const monthEndExclusive = addDays(endOfMonth(parseDate(fechaFin)), 1);
    const rows = await this.prisma.esiosProfileIntermediateResult.findMany({
      where: {
        datetime: {
          gte: monthStart,
          lt: monthEndExclusive
        },
        tariff: { in: ["2.0TD", "3.0TD", "3.0TDVE"] }
      },
      select: {
        year: true,
        month: true,
        day: true,
        hour: true,
        datetime: true,
        tariff: true,
        intermediateProfile: true
      },
      orderBy: [{ datetime: "asc" }, { tariff: "asc" }]
    });

    return normalizeProfilesByMonthlyWeight(rows, fechaInicio, fechaFin);
  }
}

class UnitProfileStrategy implements ProfileStrategy {
  async getHourlyWeights(fechaInicio: string, fechaFin: string) {
    const map = new Map<string, Partial<PricingProfileValues>>();
    for (const row of buildPricingCalendarRange(fechaInicio, fechaFin)) {
      map.set(`${row.fecha}|${row.ordenHora}`, {
        profile61td: 1,
        profile61tdStatus: "ok",
        profile61tdSource: "UNIT_PROFILE"
      });
    }
    return map;
  }
}

type RawProfileRow = {
  year: number;
  month: number;
  day: number;
  hour: number;
  tariff: string;
  intermediateProfile: Prisma.Decimal | number | null;
};

export function normalizeProfilesByMonthlyWeight(rows: RawProfileRow[], fechaInicio: string, fechaFin: string) {
  const monthlySums = new Map<string, number>();
  for (const row of rows) {
    const value = decimalToNumber(row.intermediateProfile);
    if (value === null) {
      continue;
    }
    const key = monthlyKey(row);
    monthlySums.set(key, (monthlySums.get(key) ?? 0) + value);
  }

  const rangeStart = parseDate(fechaInicio).getTime();
  const rangeEnd = parseDate(fechaFin).getTime();
  const map = new Map<string, PricingProfileValues>();
  for (const row of rows) {
    const rowDate = `${row.year}-${pad(row.month)}-${pad(row.day)}`;
    const rowTime = parseDate(rowDate).getTime();
    if (rowTime < rangeStart || rowTime > rangeEnd) {
      continue;
    }

    const value = decimalToNumber(row.intermediateProfile);
    const monthlySum = monthlySums.get(monthlyKey(row)) ?? 0;
    const normalizedValue = value !== null && monthlySum > 0 ? value / monthlySum : null;
    const status = normalizedValue === null ? "missing" : "ok";
    const key = `${rowDate}|${row.hour}`;
    const current = map.get(key) ?? emptyProfileValues();

    if (row.tariff === "2.0TD") {
      current.profile20td = normalizedValue;
      current.profile20tdStatus = status;
      current.profile20tdSource = "REE_PROFILE";
    }
    if (row.tariff === "3.0TD") {
      current.profile30td = normalizedValue;
      current.profile30tdStatus = status;
      current.profile30tdSource = "REE_PROFILE";
    }
    if (row.tariff === "3.0TDVE") {
      current.profile30tdve = normalizedValue;
      current.profile30tdveStatus = status;
      current.profile30tdveSource = "REE_PROFILE";
    }
    map.set(key, current);
  }
  return map;
}

function emptyProfileValues(): PricingProfileValues {
  return {
    profile20td: null,
    profile30td: null,
    profile30tdve: null,
    profile61td: null,
    profile20tdStatus: "missing",
    profile30tdStatus: "missing",
    profile30tdveStatus: "missing",
    profile61tdStatus: "missing",
    profile20tdSource: "REE_PROFILE",
    profile30tdSource: "REE_PROFILE",
    profile30tdveSource: "REE_PROFILE",
    profile61tdSource: "UNIT_PROFILE"
  };
}

function monthlyKey(row: Pick<RawProfileRow, "year" | "month" | "tariff">) {
  return `${row.year}-${pad(row.month)}|${row.tariff}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (typeof value === "number") {
    return value;
  }
  return value === null || value === undefined ? null : Number(value);
}
